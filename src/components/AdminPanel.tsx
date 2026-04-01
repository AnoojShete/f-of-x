import { useState } from 'react';
import Graph from './Graph';
import GameObjectsOverlay from './GameObjectsOverlay';
import type { GraphPlot, Vec2 } from '../types';
import type { GameStar } from './GameObjectsOverlay';
import type { LevelRecord } from '../types';

export type AdminPanelProps = {
  width: number;
  height: number;
  scale: number;
  plots: ReadonlyArray<GraphPlot>;
  initialLevel: LevelRecord;
};

type PointForm = { x: string; y: string };

function toFixedString(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function parseOrZero(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function AdminPanel({ width, height, scale, plots, initialLevel }: AdminPanelProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [start, setStart] = useState<PointForm>({ x: toFixedString(initialLevel.start.x), y: toFixedString(initialLevel.start.y) });
  const [goal, setGoal] = useState<PointForm>({ x: toFixedString(initialLevel.goal.x), y: toFixedString(initialLevel.goal.y) });
  const [stars, setStars] = useState<PointForm[]>(
    initialLevel.stars.map((s) => ({ x: toFixedString(s.x), y: toFixedString(s.y) }))
  );

  const previewStart: Vec2 = { x: parseOrZero(start.x), y: parseOrZero(start.y) };
  const previewGoal: Vec2 = { x: parseOrZero(goal.x), y: parseOrZero(goal.y) };
  const previewStars: GameStar[] = stars.map((s, index) => ({
    id: `preview-star-${index + 1}`,
    position: { x: parseOrZero(s.x), y: parseOrZero(s.y) },
  }));

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, padding: 10, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Admin Panel (Prep)</strong>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ padding: '4px 8px' }}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open ? (
        <>
          <div style={{ display: 'grid', gap: 6 }}>
            <div><strong>Start</strong></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={start.x} onChange={(e) => setStart((v) => ({ ...v, x: e.target.value }))} placeholder="x" style={{ width: 100 }} />
              <input value={start.y} onChange={(e) => setStart((v) => ({ ...v, y: e.target.value }))} placeholder="y" style={{ width: 100 }} />
            </div>

            <div><strong>Goal</strong></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={goal.x} onChange={(e) => setGoal((v) => ({ ...v, x: e.target.value }))} placeholder="x" style={{ width: 100 }} />
              <input value={goal.y} onChange={(e) => setGoal((v) => ({ ...v, y: e.target.value }))} placeholder="y" style={{ width: 100 }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Stars</strong>
              <button
                type="button"
                onClick={() => setStars((v) => [...v, { x: '0', y: '0' }])}
                style={{ padding: '2px 8px' }}
              >
                Add Star
              </button>
            </div>

            {stars.map((star, index) => (
              <div key={`star-form-${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={star.x}
                  onChange={(e) => {
                    const next = [...stars];
                    next[index] = { ...next[index]!, x: e.target.value };
                    setStars(next);
                  }}
                  placeholder="x"
                  style={{ width: 100 }}
                />
                <input
                  value={star.y}
                  onChange={(e) => {
                    const next = [...stars];
                    next[index] = { ...next[index]!, y: e.target.value };
                    setStars(next);
                  }}
                  placeholder="y"
                  style={{ width: 100 }}
                />
                <button
                  type="button"
                  onClick={() => setStars((v) => v.filter((_, i) => i !== index))}
                  style={{ padding: '2px 8px' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div>
            <strong>Preview</strong>
            <Graph width={width} height={height} scale={scale} plots={plots}>
              <GameObjectsOverlay
                width={width}
                height={height}
                scale={scale}
                startPoint={previewStart}
                goal={previewGoal}
                stars={previewStars}
                collectedStars={new Set<string>()}
              />
            </Graph>
          </div>
        </>
      ) : null}
    </div>
  );
}
