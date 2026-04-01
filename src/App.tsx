import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import Graph from './components/Graph';
import BallOverlay from './components/BallOverlay';
import type { LevelCompleteResult } from './components/BallOverlay';
import AdminPanel from './components/AdminPanel';
import GameObjectsOverlay from './components/GameObjectsOverlay';
import type { GameStar } from './components/GameObjectsOverlay';
import { compileExpression } from './utils/evaluate';
import { generateLevel } from './utils/levelGenerator';
import type { LevelType } from './utils/levelGenerator';
import { sampleCompiledFunction } from './utils/sample';
import type { GraphFunction } from './types';
import type { GraphPlot } from './types';
import type { LevelRecord } from './types';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 520;
const BALL_RADIUS_PX = 6;
const ACTIVE_LEVEL_TYPE: LevelType = 'sine';

type GameState = 'idle' | 'playing' | 'won';
type PhysicsSettings = {
  gravity: number;
  friction: number;
  initialVelocity: number;
  speedMultiplier: number;
};

export default function App() {
  const level = useMemo(() => generateLevel(ACTIVE_LEVEL_TYPE), []);
  const [expression, setExpression] = useState<string>(level.solution);
  const [scale, setScale] = useState<number>(60); // pixels per unit
  const [isPhysicsEnabled, setIsPhysicsEnabled] = useState<boolean>(true);
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

  const functions = useMemo<GraphFunction[]>(
    () => [
      {
        id: 'f',
        expression,
        strokeStyle: '#0b5fff',
        lineWidth: 2,
      },
    ],
    [expression]
  );

  const plots = useMemo<GraphPlot[]>(() => {
    const xMin = -CANVAS_WIDTH / 2 / scale;
    const xMax = CANVAS_WIDTH / 2 / scale;
    const maxAbsYUnits = (CANVAS_HEIGHT / 2 / scale) * 8;

    return functions.map((fn) => {
      const compiled = compileExpression(fn.expression);
      if (!compiled.ok) {
        return { ...fn, segments: [], error: compiled.error };
      }

      const segments = sampleCompiledFunction(compiled.compiled, {
        xMin,
        xMax,
        stepPx: 2,
        scale,
        maxAbsYUnits,
        maxPixelJump: CANVAS_HEIGHT * 2,
      });

      return { ...fn, segments };
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

  const collisionStars = useMemo(
    () => stars.map((s) => ({ id: s.id, x: s.position.x, y: s.position.y })),
    [stars]
  );

  const collectedStarSet = useMemo(() => new Set(collectedStarIds), [collectedStarIds]);
  const allStarsCollected = stars.length > 0 && collectedStarIds.length >= stars.length;
  const goalForCollision = allStarsCollected ? goal : undefined;

  const startGame = useCallback(() => {
    setCollectedStarIds([]);
    setLevelResult(undefined);
    setResetToken((v) => v + 1);
    setGameState('playing');
  }, []);

  const restartGame = useCallback(() => {
    setCollectedStarIds([]);
    setLevelResult(undefined);
    setResetToken((v) => v + 1);
    setGameState('idle');
  }, []);

  const handleLevelComplete = useCallback((result: LevelCompleteResult) => {
    setLevelResult(result);
    setGameState('won');
  }, []);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>f(x) engine (Phase 1)</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>f(x) =</span>
          <input
            value={expression}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setExpression(e.target.value)}
            spellCheck={false}
            style={{ width: 360, padding: '6px 8px' }}
            placeholder="e.g. 2*x+3, x^2, sin(x), 1/x"
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
      >
        <GameObjectsOverlay
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          scale={scale}
          startPoint={startPoint}
          goal={goal}
          stars={stars}
          collectedStars={collectedStarSet}
        />
        <BallOverlay
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          scale={scale}
          segments={plots[0]?.error ? [] : (plots[0]?.segments ?? [])}
          isPlaying={gameState === 'playing'}
          isPhysicsEnabled={isPhysicsEnabled}
          resetToken={resetToken}
          radiusPx={BALL_RADIUS_PX}
          startPoint={startPoint}
          gravityPxPerSec2={physicsSettings.gravity}
          frictionPerSec={physicsSettings.friction}
          initialVelocityPxPerSec={physicsSettings.initialVelocity}
          speedMultiplier={physicsSettings.speedMultiplier}
          stars={collisionStars}
          onLevelComplete={handleLevelComplete}
          onCollectedStarsChange={setCollectedStarIds}
          {...(goalForCollision ? { goal: goalForCollision } : {})}
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
