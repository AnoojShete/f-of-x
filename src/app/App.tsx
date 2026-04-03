import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Graph from '../domains/graph/components/GraphCanvas';
import BallOverlay from '../domains/gameplay/components/BallOverlay';
import AdminPanel from './components/AdminPanel';
import GameObjectsOverlay from '../domains/gameplay/components/GameObjectsOverlay';
import type { GameStar } from '../domains/gameplay/components/GameObjectsOverlay';
import { stepGameState, type LevelCompleteResult } from '../domains/gameplay/state/stepGameState';
import { stepDeterministicMode, stepPhysicsMode, type BallPhysicsState } from '../domains/physics/motion/stepPhysics';
import {
  buildTraversalPaths,
  chooseActiveSegmentIndex,
  clampInitialDistance,
  computeInitialVelocity,
  findClosestDistanceByX,
  getPathSampleAtDistance,
} from '../domains/physics/traversal/pathTraversal';
import { compileExpression } from '../shared/math/evaluate';
import { canvasToWorld } from '../shared/geometry/curveGeometry';
import { generateLevel } from '../domains/levels/generation/levelGenerator';
import type { LevelType } from '../domains/levels/generation/levelGenerator';
import { sampleCompiledFunctionDetailed } from '../domains/graph/sampling/sampleFunction';
import type { Vec2 } from '../shared/types';
import type { GraphFunction } from '../shared/types';
import type { GraphPlot } from '../shared/types';
import type { LevelRecord } from '../shared/types';
import type { Star } from '../domains/gameplay/rules/collisionRules';

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
const PHYSICS_SAMPLE_X_MIN = -240;
const PHYSICS_SAMPLE_X_MAX = 240;
const MIN_SCALE = 12;
const MAX_SCALE = 280;
const CAMERA_FOLLOW_MARGIN_RATIO = 0.32;
const SAMPLE_OVERSCAN_MULTIPLIER = 2.5;
const FUNCTION_PALETTE = ['#0b5fff', '#16a34a', '#ef4444', '#f59e0b', '#7c3aed', '#0891b2'] as const;
const INLINE_DOMAIN_REGEX = /\{\s*x\s*:\s*\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]\s*\}\s*$/i;

type GameState = 'idle' | 'playing' | 'won';
type PhysicsSettings = {
  gravity: number;
  friction: number;
  initialVelocity: number;
  speedMultiplier: number;
};

type FunctionInputRow = {
  id: string;
  expression: string;
  domainMinText: string;
  domainMaxText: string;
};

type ParsedDomainExpression = {
  expression: string;
  inlineDomainMin: number | undefined;
  inlineDomainMax: number | undefined;
  inlineDomainError?: string;
};

function parseDomainValue(value: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };

  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { ok: false, error: `Domain value "${trimmed}" is not a valid number.` };
  }

  return { ok: true, value: num };
}

function normalizeDomainBounds(minValue?: number, maxValue?: number): { min?: number; max?: number } {
  if (minValue != null && maxValue != null && minValue > maxValue) {
    return { min: maxValue, max: minValue };
  }

  const normalized: { min?: number; max?: number } = {};
  if (minValue != null) normalized.min = minValue;
  if (maxValue != null) normalized.max = maxValue;
  return normalized;
}

function parseExpressionWithInlineDomain(rawExpression: string): ParsedDomainExpression {
  const trimmed = rawExpression.trim();
  const match = trimmed.match(INLINE_DOMAIN_REGEX);
  if (!match) {
    return { expression: trimmed, inlineDomainMin: undefined, inlineDomainMax: undefined };
  }

  const [, minText, maxText] = match;
  const minResult = parseDomainValue(minText ?? '');
  const maxResult = parseDomainValue(maxText ?? '');

  if (!minResult.ok || !maxResult.ok || minResult.value == null || maxResult.value == null) {
    return {
      expression: trimmed.replace(INLINE_DOMAIN_REGEX, '').trim(),
      inlineDomainMin: undefined,
      inlineDomainMax: undefined,
      inlineDomainError: 'Inline domain must be numeric and use format {x:[min,max]}.',
    };
  }

  const normalized = normalizeDomainBounds(minResult.value, maxResult.value);
  return {
    expression: trimmed.replace(INLINE_DOMAIN_REGEX, '').trim(),
    inlineDomainMin: normalized.min,
    inlineDomainMax: normalized.max,
  };
}

function createInitialFunctionRows(solution: string): FunctionInputRow[] {
  const lines = solution
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [{ id: 'f-1', expression: '', domainMinText: '', domainMaxText: '' }];
  }

  return lines.map((line, index) => ({
    id: `f-${index + 1}`,
    expression: line,
    domainMinText: '',
    domainMaxText: '',
  }));
}

export default function App() {
  const level = useMemo(() => generateLevel(ACTIVE_LEVEL_TYPE), []);
  const [functionRows, setFunctionRows] = useState<FunctionInputRow[]>(() => createInitialFunctionRows(level.solution));
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
  const [ballRotationRad, setBallRotationRad] = useState<number>(0);

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
  const functionRowCounterRef = useRef<number>(functionRows.length + 1);

  const functionRowErrors = useMemo(() => {
    const errors: Record<string, string> = {};

    for (const row of functionRows) {
      const parsed = parseExpressionWithInlineDomain(row.expression);
      if (parsed.inlineDomainError) {
        errors[row.id] = parsed.inlineDomainError;
        continue;
      }

      const minResult = parseDomainValue(row.domainMinText);
      if (!minResult.ok) {
        errors[row.id] = minResult.error;
        continue;
      }

      const maxResult = parseDomainValue(row.domainMaxText);
      if (!maxResult.ok) {
        errors[row.id] = maxResult.error;
      }
    }

    return errors;
  }, [functionRows]);

  const functions = useMemo<GraphFunction[]>(() => {
    const out: GraphFunction[] = [];

    for (let index = 0; index < functionRows.length; index++) {
      const row = functionRows[index]!;
      if (functionRowErrors[row.id]) continue;

      const parsed = parseExpressionWithInlineDomain(row.expression);
      const expression = parsed.expression.trim();
      if (expression.length === 0) continue;

      const minResult = parseDomainValue(row.domainMinText);
      const maxResult = parseDomainValue(row.domainMaxText);
      const domainMinFromField = minResult.ok ? minResult.value : undefined;
      const domainMaxFromField = maxResult.ok ? maxResult.value : undefined;

      const normalized = normalizeDomainBounds(
        domainMinFromField ?? parsed.inlineDomainMin,
        domainMaxFromField ?? parsed.inlineDomainMax
      );

      out.push({
        id: row.id,
        expression,
        ...(normalized.min != null ? { domainMin: normalized.min } : {}),
        ...(normalized.max != null ? { domainMax: normalized.max } : {}),
        strokeStyle: FUNCTION_PALETTE[index % FUNCTION_PALETTE.length]!,
        lineWidth: 2,
      });
    }

    return out;
  }, [functionRows, functionRowErrors]);

  const plots = useMemo<GraphPlot[]>(() => {
    const visibleHalfSpan = CANVAS_WIDTH / 2 / scale;
    const overscan = visibleHalfSpan * SAMPLE_OVERSCAN_MULTIPLIER;
    const xMin = cameraCenter.x - visibleHalfSpan - overscan;
    const xMax = cameraCenter.x + visibleHalfSpan + overscan;

    return functions.map((fn) => {
      const compiled = compileExpression(fn.expression);
      if (!compiled.ok) {
        return { ...fn, segments: [], error: compiled.error };
      }

      const sampledXMin = fn.domainMin == null ? xMin : Math.max(xMin, fn.domainMin);
      const sampledXMax = fn.domainMax == null ? xMax : Math.min(xMax, fn.domainMax);
      if (!(sampledXMax > sampledXMin)) {
        return { ...fn, segments: [], holes: [] };
      }

      const sampled = sampleCompiledFunctionDetailed(compiled.compiled, {
        xMin: sampledXMin,
        xMax: sampledXMax,
        stepWorld: SAMPLE_STEP_WORLD,
        maxAbsYUnits: SAMPLE_MAX_ABS_Y_WORLD,
        maxPixelJump: CANVAS_HEIGHT * 2,
      });

      return { ...fn, segments: sampled.segments, holes: sampled.holes };
    });
  }, [functions, scale, cameraCenter]);

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

  const physicsPlots = useMemo<GraphPlot[]>(() => {
    return functions.map((fn) => {
      const compiled = compileExpression(fn.expression);
      if (!compiled.ok) {
        return { ...fn, segments: [], error: compiled.error };
      }

      const sampledXMin = fn.domainMin == null ? PHYSICS_SAMPLE_X_MIN : Math.max(PHYSICS_SAMPLE_X_MIN, fn.domainMin);
      const sampledXMax = fn.domainMax == null ? PHYSICS_SAMPLE_X_MAX : Math.min(PHYSICS_SAMPLE_X_MAX, fn.domainMax);
      if (!(sampledXMax > sampledXMin)) {
        return { ...fn, segments: [], holes: [] };
      }

      const sampled = sampleCompiledFunctionDetailed(compiled.compiled, {
        xMin: sampledXMin,
        xMax: sampledXMax,
        stepWorld: SAMPLE_STEP_WORLD,
        maxAbsYUnits: SAMPLE_MAX_ABS_Y_WORLD,
      });

      return { ...fn, segments: sampled.segments, holes: sampled.holes };
    });
  }, [functions]);

  const traversalPaths = useMemo(() => {
    const mergedSegments = physicsPlots.flatMap((plot) => (plot.error ? [] : plot.segments));
    return buildTraversalPaths(mergedSegments);
  }, [physicsPlots]);

  const collectedStarSet = useMemo(() => new Set(collectedStarIds), [collectedStarIds]);
  const allStarsCollected = stars.length > 0 && collectedStarIds.length >= stars.length;
  const goalForCollision = allStarsCollected ? goal : undefined;

  const resetBallToLevelStart = useCallback(() => {
    setBallPosition(startPoint);
    setIsBallOnCurve(false);
    setBallTangent({ x: 1, y: 0 });
    setBallRotationRad(0);
  }, [startPoint]);

  const addFunctionRow = useCallback(() => {
    const nextId = `f-${functionRowCounterRef.current}`;
    functionRowCounterRef.current += 1;
    setFunctionRows((prev) => [...prev, { id: nextId, expression: '', domainMinText: '', domainMaxText: '' }]);
  }, []);

  const removeFunctionRow = useCallback((rowId: string) => {
    setFunctionRows((prev) => {
      if (prev.length <= 1) {
        return [{ ...prev[0]!, expression: '', domainMinText: '', domainMaxText: '' }];
      }
      return prev.filter((row) => row.id !== rowId);
    });
  }, []);

  const updateFunctionRow = useCallback((rowId: string, patch: Partial<FunctionInputRow>) => {
    setFunctionRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }, []);

  const startGame = useCallback(() => {
    setCollectedStarIds([]);
    setLevelResult(undefined);
    setCameraCenter({ x: 0, y: 0 });
    resetBallToLevelStart();
    collectedIdsRef.current = new Set();
    goalReachedRef.current = false;
    runCompletedRef.current = false;
    lastTimeRef.current = undefined;
    setBallRotationRad(0);
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
    setBallRotationRad(0);
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

  const handleGraphPan = useCallback((deltaWorld: Vec2) => {
    setIsCameraFollowEnabled(false);
    setCameraCenter((prev) => ({
      x: prev.x + deltaWorld.x,
      y: prev.y + deltaWorld.y,
    }));
  }, []);

  const handleGraphZoom = useCallback(
    (zoomFactor: number, pivotCanvas: Vec2) => {
      setIsCameraFollowEnabled(false);
      setScale((prevScale) => {
        const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prevScale * zoomFactor));
        if (Math.abs(nextScale - prevScale) < 1e-9) return prevScale;

        setCameraCenter((prevCenter) => {
          const worldAtPivotBefore = canvasToWorld(pivotCanvas, CANVAS_WIDTH, CANVAS_HEIGHT, prevScale, prevCenter);
          const worldAtPivotAfter = canvasToWorld(pivotCanvas, CANVAS_WIDTH, CANVAS_HEIGHT, nextScale, prevCenter);
          return {
            x: prevCenter.x + (worldAtPivotBefore.x - worldAtPivotAfter.x),
            y: prevCenter.y + (worldAtPivotBefore.y - worldAtPivotAfter.y),
          };
        });

        return nextScale;
      });
    },
    []
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

        let rolledDistanceWorld = 0;
        if (next.motionState === 'onCurve' && current.motionState === 'onCurve' && next.activeSegmentIndex === current.activeSegmentIndex) {
          rolledDistanceWorld = next.distance - current.distance;
        } else if (next.motionState === 'onCurve') {
          rolledDistanceWorld = (next.velocity * speedScale * dt) / Math.max(1, scale);
        }

        if (rolledDistanceWorld !== 0) {
          const deltaRotation = (rolledDistanceWorld * scale) / Math.max(1e-6, BALL_RADIUS_PX);
          setBallRotationRad((prev) => prev + deltaRotation);
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
        if (isCameraFollowEnabled) {
          setCameraCenter((prev) => {
            const smoothed = {
              x: prev.x + (next.ballWorld.x - prev.x) * 0.12,
              y: prev.y + (next.ballWorld.y - prev.y) * 0.12,
            };

            // Keep the ball inside a safe viewport margin even during fast movement.
            const halfVisibleX = CANVAS_WIDTH / 2 / Math.max(1e-6, scale);
            const halfVisibleY = CANVAS_HEIGHT / 2 / Math.max(1e-6, scale);
            const marginX = halfVisibleX * CAMERA_FOLLOW_MARGIN_RATIO;
            const marginY = halfVisibleY * CAMERA_FOLLOW_MARGIN_RATIO;
            const maxBallOffsetX = Math.max(0, halfVisibleX - marginX);
            const maxBallOffsetY = Math.max(0, halfVisibleY - marginY);

            const dx = next.ballWorld.x - smoothed.x;
            const dy = next.ballWorld.y - smoothed.y;

            return {
              x: Math.abs(dx) <= maxBallOffsetX ? smoothed.x : next.ballWorld.x - Math.sign(dx) * maxBallOffsetX,
              y: Math.abs(dy) <= maxBallOffsetY ? smoothed.y : next.ballWorld.y - Math.sign(dy) * maxBallOffsetY,
            };
          });
        }

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
    isCameraFollowEnabled,
    handleLevelComplete,
  ]);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>f(x) engine (Phase 1)</h1>

      <div style={{ display: 'grid', gap: 12 }}>
        <div
          style={{
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 8,
            padding: 10,
            display: 'grid',
            gap: 8,
            maxWidth: 760,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Functions</strong>
            <button type="button" onClick={addFunctionRow} style={{ padding: '4px 8px' }}>
              + Add function
            </button>
          </div>

          {functionRows.map((row, index) => {
            const color = FUNCTION_PALETTE[index % FUNCTION_PALETTE.length];
            const rowError = functionRowErrors[row.id];
            return (
              <div
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '26px minmax(200px, 1fr) 110px 110px auto',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span style={{ color, fontWeight: 700, textAlign: 'center' }}>{index + 1}</span>
                <input
                  value={row.expression}
                  onChange={(e) => updateFunctionRow(row.id, { expression: e.target.value })}
                  spellCheck={false}
                  placeholder="f(x), example: sin(x) or x^2 {x:[-3,3]}"
                  style={{ padding: '6px 8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
                />
                <input
                  value={row.domainMinText}
                  onChange={(e) => updateFunctionRow(row.id, { domainMinText: e.target.value })}
                  placeholder="domain min"
                  style={{ padding: '6px 8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
                />
                <input
                  value={row.domainMaxText}
                  onChange={(e) => updateFunctionRow(row.id, { domainMaxText: e.target.value })}
                  placeholder="domain max"
                  style={{ padding: '6px 8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
                />
                <button
                  type="button"
                  onClick={() => removeFunctionRow(row.id)}
                  title="Remove function"
                  style={{ padding: '6px 10px' }}
                >
                  Remove
                </button>
                {rowError ? (
                  <div style={{ gridColumn: '2 / span 4', fontSize: 12, color: '#b91c1c' }}>{rowError}</div>
                ) : null}
              </div>
            );
          })}

          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Domain supports fields or inline syntax like <code>x^2 {'{x:[-2,2]}'}</code>.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>Scale</span>
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
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
        onPan={handleGraphPan}
        onZoom={handleGraphZoom}
      >
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 5,
            fontSize: 12,
            padding: '6px 8px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.86)',
            border: '1px solid rgba(0,0,0,0.14)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            pointerEvents: 'none',
          }}
        >
          Ball: ({ballPosition.x.toFixed(3)}, {ballPosition.y.toFixed(3)})
        </div>
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
          rotationRad={ballRotationRad}
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
