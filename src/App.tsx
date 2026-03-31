import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import Graph from './components/Graph';
import BallOverlay from './components/BallOverlay';
import GameObjectsOverlay from './components/GameObjectsOverlay';
import type { GameStar } from './components/GameObjectsOverlay';
import { compileExpression } from './utils/evaluate';
import { sampleCompiledFunction } from './utils/sample';
import type { Vec2 } from './types';
import type { GraphFunction } from './types';
import type { GraphPlot } from './types';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 520;
const START_X = -5;
const GOAL_X = 5;
const STAR_XS = [-2.5, 0, 2.5] as const;

function findPointClosestToX(plots: ReadonlyArray<GraphPlot>, x: number): Vec2 | undefined {
  const primary = plots[0];
  if (!primary || primary.error) return undefined;

  let best: Vec2 | undefined;
  let bestAbsDx = Number.POSITIVE_INFINITY;

  for (const segment of primary.segments) {
    for (const p of segment) {
      const dx = Math.abs(p.x - x);
      if (dx < bestAbsDx) {
        bestAbsDx = dx;
        best = p;
      }
    }
  }

  return best;
}

export default function App() {
  const [expression, setExpression] = useState<string>('sin(x)');
  const [scale, setScale] = useState<number>(60); // pixels per unit
  const [collectedStarIds, setCollectedStarIds] = useState<ReadonlyArray<string>>([]);

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

  const startPoint = useMemo(() => findPointClosestToX(plots, START_X), [plots]);
  const goal = useMemo(() => findPointClosestToX(plots, GOAL_X), [plots]);

  const stars = useMemo<GameStar[]>(() => {
    const built: GameStar[] = [];
    STAR_XS.forEach((x, index) => {
      const point = findPointClosestToX(plots, x);
      if (point) {
        built.push({
          id: `star-${index + 1}`,
          position: point,
        });
      }
    });
    return built;
  }, [plots]);

  const collisionStars = useMemo(
    () => stars.map((s) => ({ id: s.id, x: s.position.x, y: s.position.y })),
    [stars]
  );

  const collectedStarSet = useMemo(() => new Set(collectedStarIds), [collectedStarIds]);

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
      </div>

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
          startPoint={startPoint}
          goal={goal}
          stars={collisionStars}
          onCollectedStarsChange={setCollectedStarIds}
        />
      </Graph>

      <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
        Tip: try <code>1/x</code> to see discontinuity handling.
      </p>
    </div>
  );
}
