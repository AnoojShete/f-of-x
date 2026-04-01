import type { Vec2 } from '../types';
import { findClosestCurveCollision, findEarliestSweepCollision } from './collision';
import { getPathSampleAtDistance, type PathSample } from './traversal';

export type MotionState = 'air' | 'onCurve';

export type BallPhysicsState = {
  previousBallWorld: Vec2;
  distance: number;
  velocity: number;
  ballWorld: Vec2;
  airVelocity: Vec2;
  motionState: MotionState;
  spawnAttachGraceSec: number;
  activeSegmentIndex: number | undefined;
};

export type PhysicsStepParams = {
  dt: number;
  paths: ReadonlyArray<PathSample>;
  scale: number;
  speedScale: number;
  radiusPx: number;
  gravityPxPerSec2: number;
  frictionPerSec: number;
  maxVelocity: number;
  state: BallPhysicsState;
};

export type DeterministicStepParams = {
  dt: number;
  paths: ReadonlyArray<PathSample>;
  scale: number;
  speedPxPerSec: number;
  speedScale: number;
  state: BallPhysicsState;
};

const STATIC_VELOCITY_EPSILON = 0.01;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function stepPhysicsMode(params: PhysicsStepParams): BallPhysicsState {
  const {
    dt,
    paths,
    scale,
    speedScale,
    radiusPx,
    gravityPxPerSec2,
    frictionPerSec,
    maxVelocity,
    state,
  } = params;

  if (dt <= 0) return state;

  const resolvedSegmentIndex = state.motionState === 'onCurve'
    ? state.activeSegmentIndex
    : (state.activeSegmentIndex ?? (paths.length > 0 ? 0 : undefined));
  const activePath = resolvedSegmentIndex == null ? undefined : paths[resolvedSegmentIndex];

  let nextDistance = activePath ? clamp(state.distance, 0, activePath.totalLength) : state.distance;
  let nextVelocity = Number.isFinite(state.velocity) ? state.velocity : 0;
  let nextPreviousBallWorld = state.ballWorld;
  let nextBallWorld = state.ballWorld;
  let nextAirVelocity = state.airVelocity;
  let nextMotionState = state.motionState;
  let nextSpawnAttachGraceSec = state.spawnAttachGraceSec;
  let nextActiveSegmentIndex = state.activeSegmentIndex;

  const gravityWorldPerSec2 = -Math.max(0, gravityPxPerSec2) / Math.max(1, scale);

  if (nextMotionState === 'air') {
    nextAirVelocity = {
      x: nextAirVelocity.x,
      y: nextAirVelocity.y + gravityWorldPerSec2 * dt * speedScale,
    };

    if (nextSpawnAttachGraceSec > 0) {
      nextSpawnAttachGraceSec = Math.max(0, nextSpawnAttachGraceSec - dt);
    }

    nextBallWorld = {
      x: nextBallWorld.x + nextAirVelocity.x * dt * speedScale,
      y: nextBallWorld.y + nextAirVelocity.y * dt * speedScale,
    };

    // Continuous collision detection: sweep previous->current to prevent tunneling.
    const sweepCollision = findEarliestSweepCollision(paths, state.ballWorld, nextBallWorld);
    const proximityCollision = sweepCollision ? undefined : findClosestCurveCollision(paths, nextBallWorld);
    const collision = sweepCollision ?? proximityCollision;
    const hit = collision?.hit;
    const contactThresholdWorld = (radiusPx + 1) / Math.max(1, scale);
    const canAttachFromSpawnRules = nextSpawnAttachGraceSec <= 0 || nextAirVelocity.y < -1e-6;

    const hasSweepContact = !!sweepCollision;
    const hasProximityContact = !!proximityCollision && !!hit && hit.distanceWorld <= contactThresholdWorld;

    if (canAttachFromSpawnRules && hit && (hasSweepContact || hasProximityContact)) {
      nextMotionState = 'onCurve';
      nextDistance = hit.arcDistance;
      nextBallWorld = hit.point;
      nextActiveSegmentIndex = collision.pathIndex;

      const surfaceVelocityFromAir = dot(nextAirVelocity, hit.tangent) * scale;
      nextVelocity = clamp(surfaceVelocityFromAir, -maxVelocity, maxVelocity);
    }
  } else {
    if (!activePath) {
      nextMotionState = 'air';
      nextActiveSegmentIndex = undefined;
    } else {
      const surfaceSample = getPathSampleAtDistance(activePath, nextDistance);
      const projectedGravity = dot({ x: 0, y: -1 }, surfaceSample.tangent);
      const acceleration = projectedGravity * gravityPxPerSec2;

      if (Number.isFinite(acceleration)) {
        nextVelocity += acceleration * dt;
      }

      const frictionFactor = Math.exp(-Math.max(0, frictionPerSec) * dt);
      nextVelocity *= frictionFactor;

      if (Math.abs(nextVelocity) < STATIC_VELOCITY_EPSILON) {
        nextVelocity = 0;
      }

      nextVelocity = clamp(Number.isFinite(nextVelocity) ? nextVelocity : 0, -maxVelocity, maxVelocity);
      nextDistance = clamp(nextDistance + (nextVelocity * speedScale * dt) / Math.max(1, scale), 0, activePath.totalLength);

      const nextSample = getPathSampleAtDistance(activePath, nextDistance);
      nextBallWorld = nextSample.point;

      const atStartEdge = nextDistance <= 0.0001 && nextVelocity < 0;
      const atEndEdge = nextDistance >= activePath.totalLength - 0.0001 && nextVelocity > 0;

      if (atStartEdge || atEndEdge) {
        nextMotionState = 'air';
        nextActiveSegmentIndex = undefined;
        nextAirVelocity = {
          x: nextSample.tangent.x * (nextVelocity / Math.max(1, scale)),
          y: nextSample.tangent.y * (nextVelocity / Math.max(1, scale)),
        };
      }
    }
  }

  return {
    previousBallWorld: nextPreviousBallWorld,
    distance: nextDistance,
    velocity: nextVelocity,
    ballWorld: nextBallWorld,
    airVelocity: nextAirVelocity,
    motionState: nextMotionState,
    spawnAttachGraceSec: nextSpawnAttachGraceSec,
    activeSegmentIndex: nextActiveSegmentIndex,
  };
}

export function stepDeterministicMode(params: DeterministicStepParams): BallPhysicsState {
  const { dt, paths, scale, speedPxPerSec, speedScale, state } = params;
  if (dt <= 0) return state;

  const resolvedSegmentIndex = state.activeSegmentIndex ?? (paths.length > 0 ? 0 : undefined);
  const activePath = resolvedSegmentIndex == null ? undefined : paths[resolvedSegmentIndex];

  if (!activePath) {
    return {
      ...state,
      previousBallWorld: state.ballWorld,
      velocity: 0,
      motionState: 'onCurve',
      airVelocity: { x: 0, y: 0 },
      activeSegmentIndex: resolvedSegmentIndex,
    };
  }

  const deterministicSpeed = Math.max(0, speedPxPerSec * speedScale);
  const nextDistance = clamp(state.distance + (deterministicSpeed * dt) / Math.max(1, scale), 0, activePath.totalLength);
  const nextSample = getPathSampleAtDistance(activePath, nextDistance);

  return {
    ...state,
    previousBallWorld: state.ballWorld,
    distance: nextDistance,
    velocity: deterministicSpeed,
    ballWorld: nextSample.point,
    motionState: 'onCurve',
    airVelocity: { x: 0, y: 0 },
    activeSegmentIndex: resolvedSegmentIndex,
  };
}
