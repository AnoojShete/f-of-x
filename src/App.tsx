import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import Graph from './components/Graph';
import BallOverlay from './components/BallOverlay';
import GameObjectsOverlay from './components/GameObjectsOverlay';
import type { GameStar } from './components/GameObjectsOverlay';
import { compileExpression } from './utils/evaluate';
import { generateLevel } from './utils/levelGenerator';
import type { LevelType } from './utils/levelGenerator';
import { sampleCompiledFunction } from './utils/sample';
import type { GraphFunction } from './types';
import type { GraphPlot } from './types';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 520;
const BALL_RADIUS_PX = 6;
const ACTIVE_LEVEL_TYPE: LevelType = 'sine';

type GameState = 'idle' | 'playing' | 'won';

export default function App() {
  const level = useMemo(() => generateLevel(ACTIVE_LEVEL_TYPE), []);
  const [expression, setExpression] = useState<string>(level.solution);
  const [scale, setScale] = useState<number>(60); // pixels per unit
  const [collectedStarIds, setCollectedStarIds] = useState<ReadonlyArray<string>>([]);
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
    setResetToken((v) => v + 1);
    setGameState('playing');
  }, []);

  const restartGame = useCallback(() => {
    setCollectedStarIds([]);
    setResetToken((v) => v + 1);
    setGameState('idle');
  }, []);

  const handleGoalReached = useCallback(() => {
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
          Level Complete. Stars collected: {collectedStarIds.length}/{stars.length}
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
          resetToken={resetToken}
          radiusPx={BALL_RADIUS_PX}
          startPoint={startPoint}
          stars={collisionStars}
          onGoalReached={handleGoalReached}
          onCollectedStarsChange={setCollectedStarIds}
          {...(goalForCollision ? { goal: goalForCollision } : {})}
        />
      </Graph>

      <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
        Tip: try <code>1/x</code> to see discontinuity handling.
      </p>
    </div>
  );
}
