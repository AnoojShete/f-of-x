import { useEffect, useMemo, useRef } from 'react';
import type { GraphSegment, Vec2 } from '../types';
import { checkGoalCollision, collectStars } from '../utils/collision';
import type { Star } from '../utils/collision';
import { offsetWorldPointByNormal, upwardNormalFromTangent, worldToCanvas } from '../utils/curveGeometry';

export type LevelCompleteResult = {
  success: true;
  starsCollected: number;
  totalStars: number;
};

export type BallOverlayProps = {
  width: number;
  height: number;
  scale: number;
  segments: ReadonlyArray<GraphSegment>;
  startPoint?: Vec2;
  isPlaying?: boolean;
  isPhysicsEnabled?: boolean;
  resetToken?: number;

  /** Ball radius in pixels */
  radiusPx?: number;

  /** Ball speed along the polyline, in pixels per second */
  speedPxPerSec?: number;

  /** Gravity acceleration projected along tangent (px/sec^2). */
  gravityPxPerSec2?: number;

  /** Exponential damping per second. */
  frictionPerSec?: number;

  /** One-time initial launch speed magnitude (px/sec). */
  initialVelocityPxPerSec?: number;

  /** Global movement multiplier for debug tuning. */
  speedMultiplier?: number;

  /** Fill color */
  fillStyle?: string;

  /** Optional goal position (world units). */
  goal?: Vec2;

  /** Goal reach threshold (world units). */
  goalThreshold?: number;

  /** Optional list of stars to collect (world units). */
  stars?: ReadonlyArray<Star>;

  /** Star collection threshold (world units). */
  starThreshold?: number;

  /** Called once when the ball reaches the goal. */
  onGoalReached?: () => void;

  /** Called with run result when the level is completed. */
  onLevelComplete?: (result: LevelCompleteResult) => void;

  /** Called when a star is collected. */
  onStarCollected?: (starId: string) => void;

  /** Emits the full collected set (ids) when it changes. */
  onCollectedStarsChange?: (collectedIds: ReadonlyArray<string>) => void;

  /** Optional temporary debug vectors for tangent/normal at ball position. */
  debugVectors?: boolean;
};

type PathSample = {
  worldPoints: ReadonlyArray<Vec2>; // world-space points
  canvasPoints: ReadonlyArray<Vec2>; // canvas-space points
  cumulative: Float64Array; // cumulative arc length at each point
  totalLength: number;
};

const GRAVITY_ALONG_PATH_PX_PER_SEC2 = 420;
const MAX_DT_SEC = 0.05;
const FRICTION_PER_SEC = 0.58;
const INITIAL_DISTANCE_PX = 14;
const INITIAL_IMPULSE_PX_PER_SEC = 100;
const STATIC_VELOCITY_EPSILON = 0.01;

function buildPath(segments: ReadonlyArray<GraphSegment>, width: number, height: number, scale: number): PathSample | undefined {
  // Prefer the longest continuous segment to avoid jumping across discontinuities.
  let best: GraphSegment | undefined;
  let bestScore = 0;

  for (const seg of segments) {
    if (seg.length < 2) continue;
    const score = seg.length; // proxy for arc length; good enough at fixed sampling density
    if (score > bestScore) {
      bestScore = score;
      best = seg;
    }
  }

  if (!best || best.length < 2) return undefined;

  const worldPoints: Vec2[] = [...best];
  const canvasPoints: Vec2[] = worldPoints.map((p) => worldToCanvas(p, width, height, scale));
  const cumulative = new Float64Array(worldPoints.length);

  let total = 0;
  cumulative[0] = 0;

  for (let i = 1; i < canvasPoints.length; i++) {
    const a = canvasPoints[i - 1]!;
    const b = canvasPoints[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    total += Math.hypot(dx, dy);
    cumulative[i] = total;
  }

  if (total <= 0 || !Number.isFinite(total)) return undefined;

  return { worldPoints, canvasPoints, cumulative, totalLength: total };
}

function findSegmentIndex(cumulative: Float64Array, distance: number): number {
  // Returns i such that cumulative[i] <= distance < cumulative[i+1]
  let lo = 0;
  let hi = cumulative.length - 1;

  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= distance) lo = mid;
    else hi = mid;
  }

  return lo;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInitialDistance(path: PathSample): number {
  return clamp(INITIAL_DISTANCE_PX, 0, path.totalLength);
}

function findClosestDistanceByX(path: PathSample, targetX: number): number {
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

function computeInitialVelocity(path: PathSample, distance: number, magnitude: number): number {
  const tangent = getTangentFromNeighbors(path, distance);
  const tangentMagnitude = Math.hypot(tangent.x, tangent.y);
  if (!(tangentMagnitude > 1e-8) || !Number.isFinite(tangentMagnitude)) {
    return magnitude;
  }

  // Velocity is scalar along arc length; sign chooses tangent direction at start.
  const sign = tangent.x < 0 ? -1 : 1;
  return sign * magnitude;
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

function getTangentFromNeighbors(path: PathSample, distance: number): Vec2 {
  const count = path.worldPoints.length;
  if (count < 2) return { x: 1, y: 0 };

  const safeDistance = clamp(distance, 0, path.totalLength);
  const i = findSegmentIndex(path.cumulative, safeDistance);
  const i1 = Math.min(i + 1, count - 1);
  const d0 = path.cumulative[i]!;
  const d1 = path.cumulative[i1]!;
  const span = d1 - d0;
  const t = span > 0 ? (safeDistance - d0) / span : 0;

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

export default function BallOverlay({
  width,
  height,
  scale,
  segments,
  startPoint,
  isPlaying = true,
  isPhysicsEnabled = true,
  resetToken = 0,
  radiusPx = 6,
  speedPxPerSec = 220,
  gravityPxPerSec2 = GRAVITY_ALONG_PATH_PX_PER_SEC2,
  frictionPerSec = FRICTION_PER_SEC,
  initialVelocityPxPerSec = INITIAL_IMPULSE_PX_PER_SEC,
  speedMultiplier = 1,
  fillStyle = '#ff2d55',
  goal,
  goalThreshold = 0.25,
  stars = [],
  starThreshold = 0.25,
  onGoalReached,
  onLevelComplete,
  onStarCollected,
  onCollectedStarsChange,
  debugVectors = false,
}: BallOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const collectedStarsRef = useRef<Set<string>>(new Set());
  const goalReachedRef = useRef<boolean>(false);
  const velocityRef = useRef<number>(INITIAL_IMPULSE_PX_PER_SEC);
  const distanceRef = useRef<number>(INITIAL_DISTANCE_PX);
  const lastTimeRef = useRef<number | undefined>(undefined);
  const previousDistanceRef = useRef<number>(INITIAL_DISTANCE_PX);
  const rotationRef = useRef<number>(0);
  const completedRef = useRef<boolean>(false);

  const path = useMemo(() => buildPath(segments, width, height, scale), [segments, width, height, scale]);

  // Reset collision state when the path changes (e.g. expression or scale changes).
  useEffect(() => {
    collectedStarsRef.current = new Set();
    goalReachedRef.current = false;
    completedRef.current = false;
    const startDistance = path
      ? (startPoint ? findClosestDistanceByX(path, startPoint.x) : clampInitialDistance(path))
      : INITIAL_DISTANCE_PX;
    distanceRef.current = startDistance;
    previousDistanceRef.current = startDistance;
    const launchMagnitude = Math.max(0, initialVelocityPxPerSec);
    velocityRef.current = path ? computeInitialVelocity(path, startDistance, launchMagnitude) : launchMagnitude;
    rotationRef.current = 0;
    lastTimeRef.current = undefined;
    onCollectedStarsChange?.([]);
  }, [path, startPoint, onCollectedStarsChange, resetToken, initialVelocityPxPerSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio ?? 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!path) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    let rafId = 0;
    const speedScale = Math.max(0, speedMultiplier);
    const maxVelocity = Math.max(80, speedPxPerSec * 3) * Math.max(1, speedScale);

    const tick = (now: number) => {
      if (completedRef.current) return;

      const previousTime = lastTimeRef.current;
      lastTimeRef.current = now;

      const rawDt = previousTime == null ? 0 : (now - previousTime) / 1000;
      const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, MAX_DT_SEC);

      let distance = clamp(distanceRef.current, 0, path.totalLength);
      let velocity = Number.isFinite(velocityRef.current) ? velocityRef.current : 0;

      if (isPlaying && dt > 0) {
        if (isPhysicsEnabled) {
          const tangent = getTangentFromNeighbors(path, distance);
          const projectedGravity = 0 * tangent.x + -1 * tangent.y;
          const acceleration = projectedGravity * gravityPxPerSec2;

          if (Number.isFinite(acceleration)) {
            velocity += acceleration * dt;
          }

          // Exponential damping keeps friction smooth across variable frame times.
          const frictionFactor = Math.exp(-Math.max(0, frictionPerSec) * dt);
          velocity *= frictionFactor;

          if (Math.abs(velocity) < STATIC_VELOCITY_EPSILON) {
            velocity = 0;
          }

          velocity = clamp(Number.isFinite(velocity) ? velocity : 0, -maxVelocity, maxVelocity);
          distance = clamp(distance + velocity * speedScale * dt, 0, path.totalLength);
        } else {
          const deterministicSpeed = Math.max(0, speedPxPerSec * speedScale);
          distance = clamp(distance + deterministicSpeed * dt, 0, path.totalLength);
          velocity = deterministicSpeed;
        }
      }

      velocityRef.current = velocity;
      distanceRef.current = distance;

      const previousDistance = previousDistanceRef.current;
      const distanceDelta = distance - previousDistance;
      previousDistanceRef.current = distance;
      if (radiusPx > 1e-6 && Number.isFinite(distanceDelta)) {
        rotationRef.current += distanceDelta / radiusPx;
      }

      const i = ensureNonDegenerateSegmentIndex(path, findSegmentIndex(path.cumulative, distance));
      const aWorld = path.worldPoints[i]!;
      const bWorld = path.worldPoints[Math.min(i + 1, path.worldPoints.length - 1)]!;
      const d0 = path.cumulative[i]!;
      const d1 = path.cumulative[Math.min(i + 1, path.cumulative.length - 1)]!;

      const span = d1 - d0;
      const t = span > 0 ? clamp((distance - d0) / span, 0, 1) : 0;

      const tangent = getTangentFromNeighbors(path, distance);
      const ballWorldOnCurve: Vec2 = {
        x: lerp(aWorld.x, bWorld.x, t),
        y: lerp(aWorld.y, bWorld.y, t),
      };
      const ballWorldOffset = offsetWorldPointByNormal(ballWorldOnCurve, tangent, radiusPx, scale);
      const { x, y } = worldToCanvas(ballWorldOffset, width, height, scale);

      const ballWorld: Vec2 = {
        x: ballWorldOnCurve.x,
        y: ballWorldOnCurve.y,
      };

      // Collision logic (pure + modular): goal + star collection.
      if (isPlaying && goal && !goalReachedRef.current && checkGoalCollision(ballWorld, goal, goalThreshold)) {
        goalReachedRef.current = true;
        completedRef.current = true;

        const starsCollected = collectedStarsRef.current.size;
        const totalStars = stars.length;

        onLevelComplete?.({
          success: true,
          starsCollected,
          totalStars,
        });

        onGoalReached?.();
      }

      if (isPlaying && !completedRef.current && stars.length > 0) {
        const collected = collectedStarsRef.current;
        const { newlyCollectedIds } = collectStars(ballWorld, stars, collected, starThreshold);
        if (newlyCollectedIds.length > 0) {
          for (const id of newlyCollectedIds) {
            collected.add(id);
            onStarCollected?.(id);
          }
          onCollectedStarsChange?.([...collected]);
        }
      }

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotationRef.current);

      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      ctx.arc(0, 0, radiusPx, 0, Math.PI * 2);
      ctx.fill();

      // Visual cue so rotation is perceptible.
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(radiusPx * 0.85, 0);
      ctx.stroke();
      ctx.restore();

      if (debugVectors) {
        const centerCanvas = worldToCanvas(ballWorldOnCurve, width, height, scale);
        const tangentCanvas = { x: tangent.x, y: -tangent.y };
        const normalWorld = upwardNormalFromTangent(tangent);
        const normalCanvas = { x: normalWorld.x, y: -normalWorld.y };

        ctx.save();
        ctx.lineWidth = 2;

        ctx.strokeStyle = 'rgba(37, 99, 235, 0.8)';
        ctx.beginPath();
        ctx.moveTo(centerCanvas.x, centerCanvas.y);
        ctx.lineTo(centerCanvas.x + tangentCanvas.x * 20, centerCanvas.y + tangentCanvas.y * 20);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(22, 163, 74, 0.85)';
        ctx.beginPath();
        ctx.moveTo(centerCanvas.x, centerCanvas.y);
        ctx.lineTo(centerCanvas.x + normalCanvas.x * 20, centerCanvas.y + normalCanvas.y * 20);
        ctx.stroke();
        ctx.restore();
      }

      if (isPlaying && !completedRef.current) {
        rafId = requestAnimationFrame(tick);
      }
    };

    if (isPlaying) {
      rafId = requestAnimationFrame(tick);
    } else {
      tick(performance.now());
    }

    return () => cancelAnimationFrame(rafId);
  }, [
    width,
    height,
    path,
    isPlaying,
    radiusPx,
    speedPxPerSec,
    fillStyle,
    goal,
    goalThreshold,
    stars,
    starThreshold,
    onGoalReached,
    onLevelComplete,
    onStarCollected,
    onCollectedStarsChange,
    isPhysicsEnabled,
    gravityPxPerSec2,
    frictionPerSec,
    speedMultiplier,
    debugVectors,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
