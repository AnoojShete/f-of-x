import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import Graph from './components/Graph';
import BallOverlay from './components/BallOverlay';
import { compileExpression } from './utils/evaluate';
import { sampleCompiledFunction } from './utils/sample';
import type { GraphFunction } from './types';
import type { GraphPlot } from './types';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 520;

export default function App() {
  const [expression, setExpression] = useState<string>('sin(x)');
  const [scale, setScale] = useState<number>(60); // pixels per unit

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
        <BallOverlay
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          scale={scale}
          segments={plots[0]?.error ? [] : (plots[0]?.segments ?? [])}
        />
      </Graph>

      <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
        Tip: try <code>1/x</code> to see discontinuity handling.
      </p>
    </div>
  );
}
