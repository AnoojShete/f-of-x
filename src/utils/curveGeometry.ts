import type { Vec2 } from '../types';

export function worldToCanvas(p: Vec2, width: number, height: number, scale: number): Vec2 {
  return {
    x: width / 2 + p.x * scale,
    y: height / 2 - p.y * scale,
  };
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (!(len > 1e-8) || !Number.isFinite(len)) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function isUsableVector(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Math.hypot(v.x, v.y) > 1e-8;
}

export function findClosestPointIndexByX(points: ReadonlyArray<Vec2>, x: number): number {
  if (points.length === 0 || !Number.isFinite(x)) return 0;

  let bestIndex = 0;
  let bestAbsDx = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const dx = Math.abs(points[i]!.x - x);
    if (dx < bestAbsDx) {
      bestAbsDx = dx;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function tangentFromPointsAtIndex(points: ReadonlyArray<Vec2>, index: number): Vec2 {
  if (points.length < 2) return { x: 1, y: 0 };

  const i = Math.min(points.length - 1, Math.max(0, index));
  const prev = points[Math.max(0, i - 1)]!;
  const next = points[Math.min(points.length - 1, i + 1)]!;
  const centralRaw = { x: next.x - prev.x, y: next.y - prev.y };
  if (isUsableVector(centralRaw)) return normalize(centralRaw);

  if (i < points.length - 1) {
    const fwdRaw = { x: points[i + 1]!.x - points[i]!.x, y: points[i + 1]!.y - points[i]!.y };
    if (isUsableVector(fwdRaw)) return normalize(fwdRaw);
  }

  const backRaw = {
    x: points[i]!.x - points[Math.max(0, i - 1)]!.x,
    y: points[i]!.y - points[Math.max(0, i - 1)]!.y,
  };
  if (isUsableVector(backRaw)) return normalize(backRaw);

  return { x: 1, y: 0 };
}

export function upwardNormalFromTangent(tangent: Vec2): Vec2 {
  const t = normalize(tangent);
  let normal = normalize({ x: -t.y, y: t.x });

  // Canvas Y grows downward, so upward in screen space means negative canvas Y => positive world Y.
  if (normal.y < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }

  return normal;
}

export function offsetWorldPointByNormal(point: Vec2, tangent: Vec2, offsetPx: number, scale: number): Vec2 {
  const normal = upwardNormalFromTangent(tangent);
  const offsetWorld = scale > 0 ? offsetPx / scale : 0;
  return {
    x: point.x + normal.x * offsetWorld,
    y: point.y + normal.y * offsetWorld,
  };
}
