import type { GraphSegment, Vec2 } from '../../../shared/types';

export type PathSample = {
  worldPoints: ReadonlyArray<Vec2>;
  cumulative: Float64Array;
  totalLength: number;
};

const MAX_WORLD_ABS_Y_FOR_PHYSICS = 1e3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isValidPhysicsPoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.y) <= MAX_WORLD_ABS_Y_FOR_PHYSICS;
}

function splitSegmentByValidity(segment: ReadonlyArray<Vec2>): Vec2[][] {
  const out: Vec2[][] = [];
  let current: Vec2[] = [];

  for (const p of segment) {
    if (!isValidPhysicsPoint(p)) {
      if (current.length >= 2) out.push(current);
      current = [];
      continue;
    }
    current.push(p);
  }

  if (current.length >= 2) out.push(current);
  return out;
}

function buildPath(segment: ReadonlyArray<Vec2>): PathSample | undefined {
  if (segment.length < 2) return undefined;

  const worldPoints: Vec2[] = [...segment];
  const cumulative = new Float64Array(worldPoints.length);

  let total = 0;
  cumulative[0] = 0;

  for (let i = 1; i < worldPoints.length; i++) {
    const a = worldPoints[i - 1]!;
    const b = worldPoints[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cumulative[i] = total;
  }

  if (!(total > 0) || !Number.isFinite(total)) return undefined;

  return { worldPoints, cumulative, totalLength: total };
}

export function buildTraversalPaths(segments: ReadonlyArray<GraphSegment>): ReadonlyArray<PathSample> {
  const out: PathSample[] = [];
  for (const segment of segments) {
    const splitSegments = splitSegmentByValidity(segment);
    for (const split of splitSegments) {
      const path = buildPath(split);
      if (path) out.push(path);
    }
  }
  return out;
}

function findSegmentIndex(cumulative: Float64Array, distance: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;

  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= distance) lo = mid;
    else hi = mid;
  }

  return lo;
}

function ensureNonDegenerateSegmentIndex(path: PathSample, index: number): number {
  const maxStart = Math.max(0, path.cumulative.length - 2);
  const start = clamp(index, 0, maxStart);

  for (let i = start; i < path.cumulative.length - 1; i++) {
    if (path.cumulative[i + 1]! > path.cumulative[i]!) return i;
  }

  for (let i = start - 1; i >= 0; i--) {
    if (path.cumulative[i + 1]! > path.cumulative[i]!) return i;
  }

  return 0;
}

export function chooseActiveSegmentIndex(paths: ReadonlyArray<PathSample>, start: Vec2 | undefined): number | undefined {
  if (paths.length === 0) return undefined;
  if (!start) return 0;

  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < paths.length; i++) {
    const points = paths[i]!.worldPoints;
    for (const p of points) {
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      const score = dx * dx + dy * dy;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
  }

  return bestIndex;
}

export function clampInitialDistance(path: PathSample): number {
  return clamp(0, 0, path.totalLength);
}

export function findClosestDistanceByX(path: PathSample, targetX: number): number {
  if (!Number.isFinite(targetX) || path.worldPoints.length === 0) {
    return clampInitialDistance(path);
  }

  let bestIndex = 0;
  let bestAbsDx = Number.POSITIVE_INFINITY;

  for (let i = 0; i < path.worldPoints.length; i++) {
    const dx = Math.abs(path.worldPoints[i]!.x - targetX);
    if (dx < bestAbsDx) {
      bestAbsDx = dx;
      bestIndex = i;
    }
  }

  return clamp(path.cumulative[bestIndex] ?? 0, 0, path.totalLength);
}

export function getTangentFromNeighbors(path: PathSample, distance: number): Vec2 {
  const count = path.worldPoints.length;
  if (count < 2) return { x: 1, y: 0 };

  const safeDistance = clamp(distance, 0, path.totalLength);
  const i = findSegmentIndex(path.cumulative, safeDistance);
  const i1 = Math.min(i + 1, count - 1);
  const d0 = path.cumulative[i]!;
  const d1 = path.cumulative[i1]!;
  const span = d1 - d0;
  const t = span > 0 ? (safeDistance - d0) / span : 0;

   // At exact path boundaries, prefer direct segment tangent to avoid degenerate neighbor pairs.
  const atStartBoundary = i === 0 && t <= 1e-6;
  const atEndBoundary = i1 === count - 1 && t >= 1 - 1e-6;
  if (atStartBoundary || atEndBoundary) {
    const a = path.worldPoints[i]!;
    const b = path.worldPoints[i1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-8 && Number.isFinite(len)) {
      return { x: dx / len, y: dy / len };
    }
  }

  const anchorIndex = t < 0.5 ? i : i1;
  const prevIndex = Math.max(0, anchorIndex - 1);
  const nextIndex = Math.min(count - 1, anchorIndex + 1);

  const prev = path.worldPoints[prevIndex]!;
  const next = path.worldPoints[nextIndex]!;
  let dx = next.x - prev.x;
  let dy = next.y - prev.y;

  const length = Math.hypot(dx, dy);
  if (!(length > 1e-8) || !Number.isFinite(length)) {
    const a = path.worldPoints[i]!;
    const b = path.worldPoints[i1]!;
    dx = b.x - a.x;
    dy = b.y - a.y;
    const fallbackLength = Math.hypot(dx, dy);
    if (!(fallbackLength > 1e-8) || !Number.isFinite(fallbackLength)) {
      return { x: 1, y: 0 };
    }
    return { x: dx / fallbackLength, y: dy / fallbackLength };
  }

  return { x: dx / length, y: dy / length };
}

export function getPathSampleAtDistance(path: PathSample, rawDistance: number): { point: Vec2; tangent: Vec2 } {
  const distance = clamp(rawDistance, 0, path.totalLength);
  const i = ensureNonDegenerateSegmentIndex(path, findSegmentIndex(path.cumulative, distance));
  const a = path.worldPoints[i]!;
  const b = path.worldPoints[Math.min(i + 1, path.worldPoints.length - 1)]!;
  const d0 = path.cumulative[i]!;
  const d1 = path.cumulative[Math.min(i + 1, path.cumulative.length - 1)]!;
  const span = d1 - d0;
  const t = span > 0 ? clamp((distance - d0) / span, 0, 1) : 0;

  const point: Vec2 = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const tangent = getTangentFromNeighbors(path, distance);
  return { point, tangent };
}

export function computeInitialVelocity(path: PathSample, distance: number, magnitude: number): number {
  const tangent = getTangentFromNeighbors(path, distance);
  const tangentMagnitude = Math.hypot(tangent.x, tangent.y);
  if (!(tangentMagnitude > 1e-8) || !Number.isFinite(tangentMagnitude)) {
    return magnitude;
  }

  const sign = tangent.x < 0 ? -1 : 1;
  return sign * magnitude;
}
