import type { Vec2 } from '../../../shared/types';
import { worldToCanvas } from '../../../shared/geometry/curveGeometry';

export type GameStar = Readonly<{
  id: string;
  position: Vec2;
}>;

export type GameObjectsOverlayProps = {
  width: number;
  height: number;
  scale: number;
  cameraCenter?: Vec2;
  startPoint?: Vec2;
  goal?: Vec2;
  stars?: ReadonlyArray<GameStar>;
  collectedStars?: ReadonlySet<string>;
};

type LabelPlacement = {
  id: string;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  text: string;
  color: string;
};

type LabelBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function formatCoordValue(value: number): string {
  if (approxEqual(value, Math.PI)) return 'pi';
  if (approxEqual(value, -Math.PI)) return '-pi';
  if (approxEqual(value, Math.PI / 2)) return 'pi/2';
  if (approxEqual(value, -Math.PI / 2)) return '-pi/2';
  return (Math.round(value * 100) / 100).toFixed(2);
}

function formatVec2(p: Vec2): string {
  return `(${formatCoordValue(p.x)}, ${formatCoordValue(p.y)})`;
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function placeLabel(
  anchorX: number,
  anchorY: number,
  text: string,
  width: number,
  height: number,
  placed: LabelBox[]
): { x: number; y: number } {
  const estTextWidth = Math.max(28, text.length * 6.2);
  const half = estTextWidth / 2;
  const baseDx = anchorX >= width / 2 ? -10 : 10;
  const candidates: ReadonlyArray<Readonly<{ dx: number; dy: number }>> = [
    { dx: baseDx, dy: -12 },
    { dx: baseDx, dy: 14 },
    { dx: baseDx * 1.4, dy: -22 },
    { dx: baseDx * 1.4, dy: 24 },
    { dx: baseDx * 1.9, dy: -30 },
    { dx: baseDx * 1.9, dy: 34 },
  ];

  for (const candidate of candidates) {
    const x = Math.min(width - half - 2, Math.max(half + 2, anchorX + candidate.dx));
    const y = anchorY + candidate.dy;
    const box: LabelBox = {
      left: x - half,
      right: x + half,
      top: y - 8,
      bottom: y + 4,
    };

    const inBounds = box.top >= 0 && box.bottom <= height;
    const hasOverlap = placed.some((b) => boxesOverlap(b, box));
    if (inBounds && !hasOverlap) {
      placed.push(box);
      return { x, y };
    }
  }

  const fallbackX = Math.min(width - half - 2, Math.max(half + 2, anchorX + baseDx));
  const fallbackY = Math.min(height - 6, Math.max(10, anchorY - 12));
  placed.push({
    left: fallbackX - half,
    right: fallbackX + half,
    top: fallbackY - 8,
    bottom: fallbackY + 4,
  });
  return { x: fallbackX, y: fallbackY };
}

export default function GameObjectsOverlay({
  width,
  height,
  scale,
  cameraCenter = { x: 0, y: 0 },
  startPoint,
  goal,
  stars = [],
  collectedStars,
}: GameObjectsOverlayProps) {
  const visibleStars = stars.filter((star) => !collectedStars?.has(star.id));

  const startCanvas = startPoint ? worldToCanvas(startPoint, width, height, scale, cameraCenter) : undefined;
  const goalCanvas = goal ? worldToCanvas(goal, width, height, scale, cameraCenter) : undefined;

  const labelPlacements: LabelPlacement[] = [];
  const placedBoxes: LabelBox[] = [];

  if (startPoint && startCanvas) {
    const placed = placeLabel(startCanvas.x, startCanvas.y, formatVec2(startPoint), width, height, placedBoxes);
    labelPlacements.push({
      id: 'start',
      x: placed.x,
      y: placed.y,
      anchorX: startCanvas.x,
      anchorY: startCanvas.y,
      text: formatVec2(startPoint),
      color: '#16a34a',
    });
  }

  if (goal && goalCanvas) {
    const placed = placeLabel(goalCanvas.x, goalCanvas.y, formatVec2(goal), width, height, placedBoxes);
    labelPlacements.push({
      id: 'goal',
      x: placed.x,
      y: placed.y,
      anchorX: goalCanvas.x,
      anchorY: goalCanvas.y,
      text: formatVec2(goal),
      color: '#dc2626',
    });
  }

  for (const star of visibleStars) {
    const p = worldToCanvas(star.position, width, height, scale, cameraCenter);
    const text = formatVec2(star.position);
    const placed = placeLabel(p.x, p.y, text, width, height, placedBoxes);
    labelPlacements.push({
      id: `star-${star.id}`,
      x: placed.x,
      y: placed.y,
      anchorX: p.x,
      anchorY: p.y,
      text,
      color: '#ca8a04',
    });
  }

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
        const p = worldToCanvas(star.position, width, height, scale, cameraCenter);
        return (
          <g key={star.id}>
            <circle cx={p.x} cy={p.y} r={5} fill="#facc15" stroke="#a16207" strokeWidth={1.5} />
            <circle cx={p.x} cy={p.y} r={2} fill="#fef08a" />
          </g>
        );
      })}

      {labelPlacements.map((label) => (
        <g key={label.id}>
          <line
            x1={label.anchorX}
            y1={label.anchorY}
            x2={label.x}
            y2={label.y + (label.y < label.anchorY ? 5 : -5)}
            stroke={label.color}
            strokeOpacity={0.6}
            strokeWidth={1.2}
          />
          <text
            x={label.x}
            y={label.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={label.color}
            fontSize={11}
            fontWeight={600}
            stroke="rgba(255,255,255,0.9)"
            strokeWidth={2.5}
            paintOrder="stroke"
          >
            {label.text}
          </text>
        </g>
      ))}
    </svg>
  );
}
