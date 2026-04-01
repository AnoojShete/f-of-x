import type { Vec2 } from '../types';
import type { PathSample } from './traversal';

export type CurveHit = {
  point: Vec2;
  tangent: Vec2;
  distanceWorld: number;
  arcDistance: number;
};

export type CurveCollisionResult = {
  pathIndex: number;
  path: PathSample;
  hit: CurveHit;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (!(ab2 > 1e-12) || !Number.isFinite(ab2)) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return { point: a, t: 0, distance: Math.hypot(dx, dy) };
  }

  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  const q: Vec2 = { x: a.x + abx * t, y: a.y + aby * t };
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return { point: q, t, distance: Math.hypot(dx, dy) };
}

export function findClosestCurveHit(path: PathSample, ball: Vec2): CurveHit | undefined {
  if (path.worldPoints.length < 2) return undefined;

  let best: CurveHit | undefined;

  for (let i = 0; i < path.worldPoints.length - 1; i++) {
    const a = path.worldPoints[i]!;
    const b = path.worldPoints[i + 1]!;
    const hit = closestPointOnSegment(ball, a, b);

    if (hit.point.y > ball.y + 1e-6) continue;

    if (!best || hit.distance < best.distanceWorld) {
      const segPxLength = path.cumulative[i + 1]! - path.cumulative[i]!;
      const arcDistance = path.cumulative[i]! + segPxLength * hit.t;
      const tanRaw: Vec2 = { x: b.x - a.x, y: b.y - a.y };
      const tanLen = Math.hypot(tanRaw.x, tanRaw.y);
      const tangent = tanLen > 1e-8 ? { x: tanRaw.x / tanLen, y: tanRaw.y / tanLen } : { x: 1, y: 0 };

      best = {
        point: hit.point,
        tangent,
        distanceWorld: hit.distance,
        arcDistance: clamp(arcDistance, 0, path.totalLength),
      };
    }
  }

  return best;
}

export function findClosestCurveCollision(
  paths: ReadonlyArray<PathSample>,
  ball: Vec2,
  activeSegmentIndex?: number
): CurveCollisionResult | undefined {
  if (paths.length === 0) return undefined;

  if (activeSegmentIndex != null) {
    const path = paths[activeSegmentIndex];
    if (!path) return undefined;
    const hit = findClosestCurveHit(path, ball);
    return hit ? { pathIndex: activeSegmentIndex, path, hit } : undefined;
  }

  let best: CurveCollisionResult | undefined;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!;
    const hit = findClosestCurveHit(path, ball);
    if (!hit) continue;
    if (!best || hit.distanceWorld < best.hit.distanceWorld) {
      best = { pathIndex: i, path, hit };
    }
  }

  return best;
}
