import type { Vec2 } from '../types';
import type { PathSample } from './traversal';

export type CurveHit = {
  point: Vec2;
  tangent: Vec2;
  distanceWorld: number;
  verticalDistance: number;
  arcDistance: number;
};

export type CurveCollisionResult = {
  pathIndex: number;
  path: PathSample;
  hit: CurveHit;
};

export type CurveSweepCollisionResult = {
  pathIndex: number;
  path: PathSample;
  hit: CurveHit;
  travelT: number;
};

const SURFACE_NEAR_BALL_EPSILON_WORLD = 0.02;

function isSurfaceBelowOrNearBall(surfaceY: number, ballY: number): boolean {
  return surfaceY <= ballY + SURFACE_NEAR_BALL_EPSILON_WORLD;
}

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

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function segmentIntersection(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): { point: Vec2; t: number; u: number } | undefined {
  const r = subtract(a1, a0);
  const s = subtract(b1, b0);
  const qMinusP = subtract(b0, a0);
  const rxs = cross(r, s);

  if (Math.abs(rxs) < 1e-12) {
    return undefined;
  }

  const t = cross(qMinusP, s) / rxs;
  const u = cross(qMinusP, r) / rxs;
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return undefined;
  }

  return {
    point: {
      x: a0.x + r.x * t,
      y: a0.y + r.y * t,
    },
    t,
    u,
  };
}

export function findClosestCurveHit(path: PathSample, ball: Vec2): CurveHit | undefined {
  if (path.worldPoints.length < 2) return undefined;

  let best: CurveHit | undefined;

  for (let i = 0; i < path.worldPoints.length - 1; i++) {
    const a = path.worldPoints[i]!;
    const b = path.worldPoints[i + 1]!;
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(segmentLength)) {
      continue;
    }

    const hit = closestPointOnSegment(ball, a, b);

    if (!isSurfaceBelowOrNearBall(hit.point.y, ball.y)) continue;

    const verticalDistance = Math.max(0, ball.y - hit.point.y);

    if (!best || verticalDistance < best.verticalDistance || (Math.abs(verticalDistance - best.verticalDistance) < 1e-8 && hit.distance < best.distanceWorld)) {
      const segPxLength = path.cumulative[i + 1]! - path.cumulative[i]!;
      const arcDistance = path.cumulative[i]! + segPxLength * hit.t;
      const tanRaw: Vec2 = { x: b.x - a.x, y: b.y - a.y };
      const tanLen = Math.hypot(tanRaw.x, tanRaw.y);
      const tangent = tanLen > 1e-8 ? { x: tanRaw.x / tanLen, y: tanRaw.y / tanLen } : { x: 1, y: 0 };

      best = {
        point: hit.point,
        tangent,
        distanceWorld: hit.distance,
        verticalDistance,
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
    if (!best || hit.verticalDistance < best.hit.verticalDistance || (Math.abs(hit.verticalDistance - best.hit.verticalDistance) < 1e-8 && hit.distanceWorld < best.hit.distanceWorld)) {
      best = { pathIndex: i, path, hit };
    }
  }

  return best;
}

export function findEarliestSweepCollision(
  paths: ReadonlyArray<PathSample>,
  from: Vec2,
  to: Vec2,
  activeSegmentIndex?: number
): CurveSweepCollisionResult | undefined {
  if (paths.length === 0) return undefined;

  const firstPathIndex = activeSegmentIndex != null ? activeSegmentIndex : 0;
  const lastPathIndex = activeSegmentIndex != null ? activeSegmentIndex : paths.length - 1;

  let best: CurveSweepCollisionResult | undefined;

  for (let pathIndex = firstPathIndex; pathIndex <= lastPathIndex; pathIndex++) {
    const path = paths[pathIndex];
    if (!path || path.worldPoints.length < 2) continue;

    for (let i = 0; i < path.worldPoints.length - 1; i++) {
      const a = path.worldPoints[i]!;
      const b = path.worldPoints[i + 1]!;
      const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (!Number.isFinite(segmentLength)) {
        continue;
      }

      const hit = segmentIntersection(from, to, a, b);
      if (!hit) continue;

      // Reject intersections where the curve surface is above the local ball path.
      const ballYAtHit = from.y + (to.y - from.y) * hit.t;
      if (!isSurfaceBelowOrNearBall(hit.point.y, ballYAtHit)) continue;

      const tanRaw: Vec2 = { x: b.x - a.x, y: b.y - a.y };
      const tanLen = Math.hypot(tanRaw.x, tanRaw.y);
      const tangent = tanLen > 1e-8 ? { x: tanRaw.x / tanLen, y: tanRaw.y / tanLen } : { x: 1, y: 0 };
      const segLength = path.cumulative[i + 1]! - path.cumulative[i]!;
      const arcDistance = clamp(path.cumulative[i]! + segLength * hit.u, 0, path.totalLength);

      const sweepHit: CurveSweepCollisionResult = {
        pathIndex,
        path,
        travelT: hit.t,
        hit: {
          point: hit.point,
          tangent,
          distanceWorld: 0,
          verticalDistance: Math.max(0, to.y - hit.point.y),
          arcDistance,
        },
      };

      if (!best || sweepHit.travelT < best.travelT) {
        best = sweepHit;
      }
    }
  }

  return best;
}
