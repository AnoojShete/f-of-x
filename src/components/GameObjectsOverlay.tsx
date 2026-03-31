import type { Vec2 } from '../types';
import { worldToCanvas } from '../utils/curveGeometry';

export type GameStar = Readonly<{
  id: string;
  position: Vec2;
}>;

export type GameObjectsOverlayProps = {
  width: number;
  height: number;
  scale: number;
  startPoint?: Vec2;
  goal?: Vec2;
  stars?: ReadonlyArray<GameStar>;
  collectedStars?: ReadonlySet<string>;
};

export default function GameObjectsOverlay({
  width,
  height,
  scale,
  startPoint,
  goal,
  stars = [],
  collectedStars,
}: GameObjectsOverlayProps) {
  const visibleStars = stars.filter((star) => !collectedStars?.has(star.id));

  const startCanvas = startPoint ? worldToCanvas(startPoint, width, height, scale) : undefined;
  const goalCanvas = goal ? worldToCanvas(goal, width, height, scale) : undefined;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      {startCanvas ? (
        <g>
          <circle cx={startCanvas.x} cy={startCanvas.y} r={6} fill="#20b15a" stroke="#0e6c34" strokeWidth={2} />
          <circle cx={startCanvas.x} cy={startCanvas.y} r={2} fill="#b8f5d1" />
        </g>
      ) : null}

      {goalCanvas ? (
        <g>
          <circle cx={goalCanvas.x} cy={goalCanvas.y} r={7} fill="#ef4444" stroke="#991b1b" strokeWidth={2} />
          <line x1={goalCanvas.x + 9} y1={goalCanvas.y + 8} x2={goalCanvas.x + 9} y2={goalCanvas.y - 10} stroke="#374151" strokeWidth={2} />
          <path d={`M ${goalCanvas.x + 9} ${goalCanvas.y - 10} L ${goalCanvas.x + 18} ${goalCanvas.y - 7} L ${goalCanvas.x + 9} ${goalCanvas.y - 4} Z`} fill="#f97316" />
        </g>
      ) : null}

      {visibleStars.map((star) => {
        const p = worldToCanvas(star.position, width, height, scale);
        return (
          <g key={star.id}>
            <circle cx={p.x} cy={p.y} r={5} fill="#facc15" stroke="#a16207" strokeWidth={1.5} />
            <circle cx={p.x} cy={p.y} r={2} fill="#fef08a" />
          </g>
        );
      })}
    </svg>
  );
}
