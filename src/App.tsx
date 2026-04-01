import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Graph from './components/Graph';
import BallOverlay from './components/BallOverlay';
import AdminPanel from './components/AdminPanel';
import GameObjectsOverlay from './components/GameObjectsOverlay';
import type { GameStar } from './components/GameObjectsOverlay';
import { stepGameState, type LevelCompleteResult } from './core/game/gameState';
import { stepDeterministicMode, stepPhysicsMode, type BallPhysicsState } from './physics/motion';
import {
  buildTraversalPaths,
  chooseActiveSegmentIndex,
  clampInitialDistance,
  computeInitialVelocity,
  findClosestDistanceByX,
  getPathSampleAtDistance,
} from './physics/traversal';
import { compileExpression } from './utils/evaluate';
import { generateLevel } from './utils/levelGenerator';
import type { LevelType } from './utils/levelGenerator';
import { sampleCompiledFunctionDetailed } from './utils/sample';
import type { Vec2 } from './types';
import type { GraphFunction } from './types';
import type { GraphPlot } from './types';
import type { LevelRecord } from './types';
import type { Star } from './utils/collision';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 520;
const BALL_RADIUS_PX = 6;
const ACTIVE_LEVEL_TYPE: LevelType = 'sine';
const MAX_DT_SEC = 0.05;
const PHYSICS_MIN_SUBSTEPS = 4;
const PHYSICS_MAX_SUBSTEPS = 10;
const PHYSICS_SUBSTEP_TARGET_SEC = 1 / 240;
const SAMPLE_STEP_WORLD = 0.02;
const SAMPLE_MAX_ABS_Y_WORLD = 1e3;

type GameState = 'idle' | 'playing' | 'won';
type PhysicsSettings = {
  gravity: number;
  friction: number;
  initialVelocity: number;
  speedMultiplier: number;
};

export default function App() {
  const level = useMemo(() => generateLevel(ACTIVE_LEVEL_TYPE), []);
  const [functionsText, setFunctionsText] = useState<string>(level.solution);
  const [scale, setScale] = useState<number>(60); // pixels per unit
  const [isPhysicsEnabled, setIsPhysicsEnabled] = useState<boolean>(true);
  const [isCameraFollowEnabled, setIsCameraFollowEnabled] = useState<boolean>(false);
  const [cameraCenter, setCameraCenter] = useState<Vec2>({ x: 0, y: 0 });
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState<boolean>(false);
  const [physicsSettings, setPhysicsSettings] = useState<PhysicsSettings>({
    gravity: 420,
    friction: 0.58,
    initialVelocity: 100,
    speedMultiplier: 1,
  });
  const [collectedStarIds, setCollectedStarIds] = useState<ReadonlyArray<string>>([]);
  const [levelResult, setLevelResult] = useState<LevelCompleteResult | undefined>(undefined);
  const [gameState, setGameState] = useState<GameState>('idle');
  const [resetToken, setResetToken] = useState<number>(0);
  const [ballPosition, setBallPosition] = useState<Vec2>(level.start);
  const [ballTangent, setBallTangent] = useState<Vec2>({ x: 1, y: 0 });
  const [isBallOnCurve, setIsBallOnCurve] = useState<boolean>(false);

  const physicsStateRef = useRef<BallPhysicsState>({
    previousBallWorld: level.start,
    distance: 0,
    velocity: 0,
    ballWorld: level.start,
    airVelocity: { x: 0, y: 0 },
    motionState: 'air',
    spawnAttachGraceSec: 0.1,
    activeSegmentIndex: undefined,
  });
  const lastTimeRef = useRef<number | undefined>(undefined);
  const runCompletedRef = useRef<boolean>(false);
  const collectedIdsRef = useRef<Set<string>>(new Set());
  const goalReachedRef = useRef<boolean>(false);

  const functions = useMemo<GraphFunction[]>(() => {
    const palette = ['#0b5fff', '#16a34a', '#ef4444', '#f59e0b', '#7c3aed', '#0891b2'];
    const lines = functionsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.map((line, index) => ({
      id: `f-${index + 1}`,
      expression: line,
      strokeStyle: palette[index % palette.length]!,
      lineWidth: 2,
    }));
  }, [functionsText]);

  const plots = useMemo<GraphPlot[]>(() => {
    const xMin = -CANVAS_WIDTH / 2 / scale;
    const xMax = CANVAS_WIDTH / 2 / scale;

    return functions.map((fn) => {
      const compiled = compileExpression(fn.expression);
      if (!compiled.ok) {
        return { ...fn, segments: [], error: compiled.error };
      }

      const sampled = sampleCompiledFunctionDetailed(compiled.compiled, {
        xMin,
        xMax,
        stepWorld: SAMPLE_STEP_WORLD,
        maxAbsYUnits: SAMPLE_MAX_ABS_Y_WORLD,
        maxPixelJump: CANVAS_HEIGHT * 2,
      });

      return { ...fn, segments: sampled.segments, holes: sampled.holes };
    });
  }, [functions, scale]);

  const startPoint = level.start;
  const goal = level.goal;
  const levelRecord = useMemo<LevelRecord>(
    () => ({
      id: `${ACTIVE_LEVEL_TYPE}-generated-1`,
      type: ACTIVE_LEVEL_TYPE === 'sine' ? 'sine' : 'custom',
      start: level.start,
      goal: level.goal,
      stars: level.stars,
      solution: level.solution,
    }),
    [level]
  );

  const stars = useMemo<GameStar[]>(
    () => level.stars.map((position, index) => ({ id: `star-${index + 1}`, position })),
    [level]
  );

  const collisionStars = useMemo<ReadonlyArray<Star>>(
    () => stars.map((s) => ({ id: s.id, x: s.position.x, y: s.position.y })),
    [stars]
  );

  const traversalPaths = useMemo(() => {
    const mergedSegments = plots.flatMap((plot) => (plot.error ? [] : plot.segments));
    return buildTraversalPaths(mergedSegments);
  }, [plots]);

  const collectedStarSet = useMemo(() => new Set(collectedStarIds), [collectedStarIds]);
  const allStarsCollected = stars.length > 0 && collectedStarIds.length >= stars.length;
  const goalForCollision = allStarsCollected ? goal : undefined;

  const resetBallToLevelStart = useCallback(() => {
    setBallPosition(startPoint);
    setIsBallOnCurve(false);
    setBallTangent({ x: 1, y: 0 });
  }, [startPoint]);

  const startGame = useCallback(() => {
    setCollectedStarIds([]);
    setLevelResult(undefined);
    setCameraCenter({ x: 0, y: 0 });
    resetBallToLevelStart();
    collectedIdsRef.current = new Set();
    goalReachedRef.current = false;
    runCompletedRef.current = false;
    lastTimeRef.current = undefined;
    setResetToken((v) => v + 1);
    setGameState('playing');
  }, [resetBallToLevelStart]);

  const restartGame = useCallback(() => {
    setCollectedStarIds([]);
    setLevelResult(undefined);
    setCameraCenter({ x: 0, y: 0 });
    resetBallToLevelStart();
    collectedIdsRef.current = new Set();
    goalReachedRef.current = false;
    runCompletedRef.current = false;
    lastTimeRef.current = undefined;
    setResetToken((v) => v + 1);
    setGameState('idle');
  }, [resetBallToLevelStart]);

  useEffect(() => {
    resetBallToLevelStart();
  }, [resetBallToLevelStart]);

  const handleLevelComplete = useCallback((result: LevelCompleteResult) => {
    setLevelResult(result);
    setGameState('won');
  }, []);

  const handleBallPositionChange = useCallback(
    (ball: Vec2) => {
      if (!isCameraFollowEnabled) return;
      setCameraCenter((prev) => ({
        x: prev.x + (ball.x - prev.x) * 0.1,
        y: prev.y + (ball.y - prev.y) * 0.1,
      }));
    },
    [isCameraFollowEnabled]
  );

  useEffect(() => {
    const activeSegmentIndex = chooseActiveSegmentIndex(traversalPaths, startPoint);
    const activePath = activeSegmentIndex == null ? undefined : traversalPaths[activeSegmentIndex];
    const startDistance = activePath
      ? (startPoint ? findClosestDistanceByX(activePath, startPoint.x) : clampInitialDistance(activePath))
      : 0;
    const launchMagnitude = Math.max(0, physicsSettings.initialVelocity);

    physicsStateRef.current = {
      previousBallWorld: startPoint,
      distance: startDistance,
      velocity: activePath ? computeInitialVelocity(activePath, startDistance, launchMagnitude) : launchMagnitude,
      ballWorld: startPoint,
      airVelocity: { x: 0, y: 0 },
      motionState: 'air',
      spawnAttachGraceSec: 0.1,
      activeSegmentIndex,
    };

    lastTimeRef.current = undefined;
    runCompletedRef.current = false;
  }, [traversalPaths, startPoint, resetToken, physicsSettings.initialVelocity]);

  useEffect(() => {
    if (traversalPaths.length === 0) return;

    let rafId = 0;

    const tick = (now: number) => {
      const previousTime = lastTimeRef.current;
      lastTimeRef.current = now;

      const rawDt = previousTime == null ? 0 : (now - previousTime) / 1000;
      const dt = Math.min(MAX_DT_SEC, Math.max(0, Number.isFinite(rawDt) ? rawDt : 0));
      const deterministicDt = dt > 0 ? dt : 1 / 60;

      if (gameState === 'playing' && !runCompletedRef.current) {
        const speedScale = Math.max(0, physicsSettings.speedMultiplier);
        const maxVelocity = Math.max(80, 220 * 3) * Math.max(1, speedScale);

        const current = physicsStateRef.current;
        let next = current;

        if (isPhysicsEnabled) {
          const estimatedSubsteps = Math.ceil(dt / PHYSICS_SUBSTEP_TARGET_SEC);
          const substeps = Math.max(PHYSICS_MIN_SUBSTEPS, Math.min(PHYSICS_MAX_SUBSTEPS, estimatedSubsteps));
          const subDt = substeps > 0 ? dt / substeps : dt;

          // Smaller integration steps improve collision accuracy and reduce tunneling.
          for (let i = 0; i < substeps; i++) {
            next = stepPhysicsMode({
              dt: subDt,
              paths: traversalPaths,
              scale,
              speedScale,
              radiusPx: BALL_RADIUS_PX,
              gravityPxPerSec2: physicsSettings.gravity,
              frictionPerSec: physicsSettings.friction,
              maxVelocity,
              state: next,
            });
          }
        } else {
          next = stepDeterministicMode({
            dt: deterministicDt,
            paths: traversalPaths,
            scale,
            speedPxPerSec: 220,
            speedScale,
            state: current,
          });
        }

        physicsStateRef.current = next;
        setBallPosition(next.ballWorld);
        const onCurve = next.motionState === 'onCurve';
        setIsBallOnCurve(onCurve);
        if (onCurve) {
          const tangentPath = next.activeSegmentIndex == null ? undefined : traversalPaths[next.activeSegmentIndex];
          if (tangentPath) {
            const sample = getPathSampleAtDistance(tangentPath, next.distance);
            setBallTangent(sample.tangent);
          }
        }
        handleBallPositionChange(next.ballWorld);

        const gameStep = stepGameState({
          ballPosition: next.ballWorld,
          stars: collisionStars,
          starThreshold: 0.25,
          goal: goalForCollision,
          goalThreshold: 0.25,
          snapshot: {
            collectedIds: collectedIdsRef.current,
            goalReached: goalReachedRef.current,
          },
        });

        if (gameStep.newlyCollectedIds.length > 0) {
          collectedIdsRef.current = new Set(gameStep.collectedIds);
          setCollectedStarIds([...collectedIdsRef.current]);
        }

        if (gameStep.completed && gameStep.levelResult) {
          goalReachedRef.current = gameStep.goalReached;
          runCompletedRef.current = true;
          handleLevelComplete(gameStep.levelResult);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    traversalPaths,
    gameState,
    isPhysicsEnabled,
    scale,
    physicsSettings,
    collisionStars,
    goalForCollision,
    handleBallPositionChange,
    handleLevelComplete,
  ]);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>f(x) engine (Phase 1)</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 8, minWidth: 360 }}>
          <span>f(x) =</span>
          <textarea
            value={functionsText}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setFunctionsText(e.target.value)}
            spellCheck={false}
            rows={4}
            style={{ width: 360, padding: '6px 8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
            placeholder={'One function per line\n2*x+3\nsin(x)\n0.5*x^2'}
          />
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>Scale</span>
          <input
            type="range"
            min={10}
            max={140}
            value={scale}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setScale(Number(e.target.value))}
          />
          <span style={{ width: 56 }}>{scale} px/unit</span>
        </label>

        <button
          type="button"
          onClick={() => setIsPhysicsEnabled((v) => !v)}
          style={{ padding: '6px 10px' }}
        >
          Physics: {isPhysicsEnabled ? 'ON' : 'OFF'}
        </button>

        <button
          type="button"
          onClick={() => {
            setIsCameraFollowEnabled((v) => {
              const next = !v;
              if (!next) setCameraCenter({ x: 0, y: 0 });
              return next;
            });
          }}
          style={{ padding: '6px 10px' }}
        >
          Camera Follow: {isCameraFollowEnabled ? 'ON' : 'OFF'}
        </button>

        <button
          type="button"
          onClick={() => setIsDebugPanelOpen((v) => !v)}
          style={{ padding: '6px 10px' }}
        >
          {isDebugPanelOpen ? 'Hide' : 'Show'} Debug
        </button>

        <button
          type="button"
          onClick={startGame}
          disabled={gameState === 'playing'}
          style={{ padding: '6px 10px' }}
        >
          Play
        </button>

        <button
          type="button"
          onClick={restartGame}
          style={{ padding: '6px 10px' }}
        >
          Restart
        </button>

        <span style={{ fontSize: 13, opacity: 0.85 }}>
          State: {gameState}
        </span>
      </div>

      {isDebugPanelOpen ? (
        <div
          style={{
            justifySelf: 'end',
            width: 320,
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 8,
            padding: 10,
            display: 'grid',
            gap: 8,
            background: 'rgba(255,255,255,0.88)',
          }}
        >
          <strong>Physics Debug Settings</strong>

          <label style={{ display: 'grid', gap: 4 }}>
            <span>Gravity: {physicsSettings.gravity.toFixed(0)}</span>
            <input
              type="range"
              min={120}
              max={900}
              step={10}
              value={physicsSettings.gravity}
              onChange={(e) => setPhysicsSettings((s) => ({ ...s, gravity: Number(e.target.value) }))}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span>Friction: {physicsSettings.friction.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={physicsSettings.friction}
              onChange={(e) => setPhysicsSettings((s) => ({ ...s, friction: Number(e.target.value) }))}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span>Initial Velocity: {physicsSettings.initialVelocity.toFixed(0)}</span>
            <input
              type="range"
              min={0}
              max={260}
              step={5}
              value={physicsSettings.initialVelocity}
              onChange={(e) => setPhysicsSettings((s) => ({ ...s, initialVelocity: Number(e.target.value) }))}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span>Speed Multiplier: {physicsSettings.speedMultiplier.toFixed(2)}</span>
            <input
              type="range"
              min={0.2}
              max={2.5}
              step={0.05}
              value={physicsSettings.speedMultiplier}
              onChange={(e) => setPhysicsSettings((s) => ({ ...s, speedMultiplier: Number(e.target.value) }))}
            />
          </label>
        </div>
      ) : null}

      {gameState === 'won' ? (
        <div
          style={{
            padding: '8px 10px',
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 6,
            background: 'rgba(34,197,94,0.10)',
            fontSize: 13,
          }}
        >
          Level Complete. Stars: {levelResult?.starsCollected ?? collectedStarIds.length}/{levelResult?.totalStars ?? stars.length}
        </div>
      ) : null}

      <Graph
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        scale={scale}
        plots={plots}
        cameraCenter={cameraCenter}
      >
        <GameObjectsOverlay
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          scale={scale}
          cameraCenter={cameraCenter}
          startPoint={startPoint}
          goal={goal}
          stars={stars}
          collectedStars={collectedStarSet}
        />
        <BallOverlay
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          scale={scale}
          cameraCenter={cameraCenter}
          ballPosition={ballPosition}
          tangent={ballTangent}
          isOnCurve={isBallOnCurve}
          radiusPx={BALL_RADIUS_PX}
        />
      </Graph>

      <AdminPanel
        width={Math.floor(CANVAS_WIDTH * 0.72)}
        height={Math.floor(CANVAS_HEIGHT * 0.52)}
        scale={scale}
        plots={plots}
        initialLevel={levelRecord}
      />

      <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
        Tip: try <code>1/x</code> to see discontinuity handling.
      </p>
    </div>
  );
}
