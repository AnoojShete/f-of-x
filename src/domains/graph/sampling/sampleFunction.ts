import type { GraphSegment, Vec2 } from '../../../shared/types';
import type { CompiledExpression } from '../../../shared/math/evaluate';
import { evaluateCompiledAt } from '../../../shared/math/evaluate';

export type SamplingOptions = {
  xMin: number;
  xMax: number;

  // World-space sampling step, independent of render scale.
  stepWorld?: number;

  /** @deprecated prefer stepWorld */
  stepPx?: number;

  /** @deprecated used only as fallback with stepPx */
  scale?: number;

  // Discontinuity heuristics
  maxAbsYUnits: number;
  /** @deprecated kept for backward compatibility; no longer used for discontinuity splitting */
  maxPixelJump?: number;
  maxWorldAbsY?: number;
  maxWorldDyJump?: number;
  maxAbsSlope?: number;
};

export type SamplingResult = {
  segments: ReadonlyArray<GraphSegment>;
  holes: ReadonlyArray<Vec2>;
};

const DEFAULT_MAX_WORLD_ABS_Y = 1e3;
const DEFAULT_MAX_WORLD_DY_JUMP = 2;
const DEFAULT_MAX_ABS_SLOPE = 8;
const SAME_X_EPSILON = 1e-9;
const SAME_X_JUMP_THRESHOLD = 0.5;
const MIN_VALID_SEGMENT_POINTS = 2;
const MIN_VALID_SEGMENT_LENGTH_WORLD = 1e-3;
const ADAPTIVE_MAX_STEP_WORLD = 0.02;
const ADAPTIVE_MIN_STEP_WORLD = 0.002;
const DISCONTINUITY_PROBE_T_VALUES = [0.25, 0.5, 0.75] as const;

function isValidSamplePoint(p: Vec2, maxWorldAbsY: number): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.y) <= maxWorldAbsY;
}

function isValidWorldY(y: number, maxWorldAbsY: number): boolean {
  return Number.isFinite(y) && Math.abs(y) <= maxWorldAbsY;
}

function hasDiscontinuityBetween(
  compiled: CompiledExpression,
  prev: Vec2,
  next: Vec2,
  maxAbsYUnits: number,
  maxWorldAbsY: number,
  maxWorldDyJump: number
): boolean {
  const dx = Math.abs(next.x - prev.x);
  const endpointDy = Math.abs(next.y - prev.y);

  // Large opposite-sign values over a tiny x-span are usually asymptotic behavior.
  const largeOppositeSignEndpoints =
    prev.y * next.y < 0 &&
    Math.abs(prev.y) > maxWorldDyJump &&
    Math.abs(next.y) > maxWorldDyJump &&
    dx <= 0.25;
  if (largeOppositeSignEndpoints) return true;

  const probeYs: number[] = [];
  for (const t of DISCONTINUITY_PROBE_T_VALUES) {
    const probeX = prev.x + (next.x - prev.x) * t;
    const probe = evaluateCompiledAt(compiled, probeX, { maxAbsValue: maxAbsYUnits });
    if (!probe.ok || !isValidWorldY(probe.value, maxWorldAbsY)) {
      return true;
    }
    probeYs.push(probe.value);
  }

  // For smooth monotone spans, polyline variation stays near endpoint variation.
  // Asymptotic spikes inflate this significantly even if probes are finite.
  const pathVariation =
    Math.abs(probeYs[0]! - prev.y) +
    Math.abs(probeYs[1]! - probeYs[0]!) +
    Math.abs(probeYs[2]! - probeYs[1]!) +
    Math.abs(next.y - probeYs[2]!);

  return pathVariation > endpointDy * 4 + maxWorldDyJump;
}

function pushPoint(segments: Vec2[][], p: Vec2) {
  const lastSegment = segments[segments.length - 1];
  if (lastSegment) lastSegment.push(p);
}

function startNewSegment(segments: Vec2[][]) {
  segments.push([]);
}

function pushHole(holes: Vec2[], p: Vec2) {
  const eps = 1e-9;
  for (const h of holes) {
    if (Math.abs(h.x - p.x) < eps && Math.abs(h.y - p.y) < eps) return;
  }
  holes.push(p);
}

function segmentLengthWorld(segment: ReadonlyArray<Vec2>): number {
  if (segment.length < 2) return 0;

  let total = 0;
  for (let i = 1; i < segment.length; i++) {
    const a = segment[i - 1]!;
    const b = segment[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function isValidOutputSegment(segment: ReadonlyArray<Vec2>): boolean {
  if (segment.length < MIN_VALID_SEGMENT_POINTS) return false;
  return segmentLengthWorld(segment) >= MIN_VALID_SEGMENT_LENGTH_WORLD;
}

/**
 * Samples a compiled y=f(x) expression over [xMin, xMax] and returns polyline segments.
 *
 * The output is split into segments to avoid connecting across discontinuities:
 * - undefined/non-finite y (NaN, Infinity)
 * - extremely large values
 * - large world-space jumps between consecutive samples
 * - extreme local slope (near-vertical behavior such as tan asymptotes)
 */
export function sampleCompiledFunctionDetailed(compiled: CompiledExpression, opts: SamplingOptions): SamplingResult {
  const worldStepFromLegacy =
    opts.stepPx != null && opts.scale != null && opts.scale > 0
      ? opts.stepPx / opts.scale
      : undefined;
  const configuredMaxStep = Math.max(ADAPTIVE_MIN_STEP_WORLD, opts.stepWorld ?? worldStepFromLegacy ?? ADAPTIVE_MAX_STEP_WORLD);
  const maxWorldAbsY = Math.min(opts.maxAbsYUnits, opts.maxWorldAbsY ?? DEFAULT_MAX_WORLD_ABS_Y);
  const maxWorldDyJump = opts.maxWorldDyJump ?? DEFAULT_MAX_WORLD_DY_JUMP;
  const maxAbsSlope = opts.maxAbsSlope ?? DEFAULT_MAX_ABS_SLOPE;

  const segments: Vec2[][] = [];
  const holes: Vec2[] = [];
  startNewSegment(segments);

  let prev: Vec2 | undefined;

  // Ensure consistent stepping direction
  const dir = opts.xMax >= opts.xMin ? 1 : -1;

  const getAdaptiveStep = (x: number): number => {
    const baseAdaptiveStep = Math.min(
      ADAPTIVE_MAX_STEP_WORLD,
      Math.max(ADAPTIVE_MIN_STEP_WORLD, 1 / (1 + Math.abs(x)))
    );
    return Math.min(configuredMaxStep, baseAdaptiveStep);
  };

  let x = opts.xMin;
  while (dir > 0 ? x <= opts.xMax : x >= opts.xMax) {
    const result = evaluateCompiledAt(compiled, x, { maxAbsValue: opts.maxAbsYUnits });
    const isInvalidResult = !result.ok;
    if (isInvalidResult) {
      prev = undefined;
      startNewSegment(segments);
    } else {
      const y = result.value;
      if (!Number.isFinite(y) || Math.abs(y) > maxWorldAbsY) {
        prev = undefined;
        startNewSegment(segments);
      } else {
        const p: Vec2 = { x, y };
        if (!isValidSamplePoint(p, maxWorldAbsY)) {
          prev = undefined;
          startNewSegment(segments);
        } else {
          let skipCurrentPoint = false;

          if (prev) {
            const dy = Math.abs(p.y - prev.y);
            const dx = Math.abs(p.x - prev.x);
            const slope = dx > 1e-12 ? dy / dx : Number.POSITIVE_INFINITY;

            // Prevent vertical connectors for step-like jumps (e.g. floor/ceil) at the same x.
            const isSameXJump = dx <= SAME_X_EPSILON && dy > SAME_X_JUMP_THRESHOLD;

            const isDiscontinuityCandidate = isSameXJump || dy > maxWorldDyJump || slope > maxAbsSlope;
            if (isDiscontinuityCandidate) {
              const shouldSplit = isSameXJump || hasDiscontinuityBetween(compiled, prev, p, opts.maxAbsYUnits, maxWorldAbsY, maxWorldDyJump);

              if (shouldSplit) {
                // Break the polyline at asymptotes/discontinuities; do not connect prev to current.
                // Both points are finite here, so this may represent a removable discontinuity.
                pushHole(holes, prev);
                pushHole(holes, p);
                prev = undefined;
                startNewSegment(segments);

                // Avoid immediate reattachment on asymptote-edge samples.
                if (dy > maxWorldDyJump || slope > maxAbsSlope) {
                  skipCurrentPoint = true;
                }
              }
            }
          }

          if (!skipCurrentPoint) {
            if (!prev) {
              // Ensure segment exists
              if (segments.length === 0) startNewSegment(segments);
              pushPoint(segments, p);
              prev = p;
            } else {
              pushPoint(segments, p);
              prev = p;
            }
          }
        }
      }
    }

    const adaptiveStep = getAdaptiveStep(x);
    const remaining = Math.abs(opts.xMax - x);
    if (remaining <= 1e-12) break;
    x += Math.min(adaptiveStep, remaining) * dir;
  }

  // Keep only physically meaningful continuous geometry.
  // This prevents fake continuity and avoids 1-point or near-zero fragments.
  return {
    segments: segments.filter(isValidOutputSegment),
    holes,
  };
}

export function sampleCompiledFunction(compiled: CompiledExpression, opts: SamplingOptions): ReadonlyArray<GraphSegment> {
  return sampleCompiledFunctionDetailed(compiled, opts).segments;
}
