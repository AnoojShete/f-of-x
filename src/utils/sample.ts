import type { GraphSegment, Vec2 } from '../types';
import type { CompiledExpression } from './evaluate';
import { evaluateCompiledAt } from './evaluate';

export type SamplingOptions = {
  xMin: number;
  xMax: number;

  // How densely to sample. We specify in pixels to keep resolution stable across zoom.
  stepPx: number;
  scale: number;

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
const DEFAULT_MAX_WORLD_DY_JUMP = 5;
const DEFAULT_MAX_ABS_SLOPE = 14;
const SAME_X_EPSILON = 1e-9;
const SAME_X_JUMP_THRESHOLD = 0.5;

function isValidSamplePoint(p: Vec2, maxWorldAbsY: number): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.y) <= maxWorldAbsY;
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
  const stepUnits = Math.max(0.0005, opts.stepPx / opts.scale);
  const maxWorldAbsY = Math.min(opts.maxAbsYUnits, opts.maxWorldAbsY ?? DEFAULT_MAX_WORLD_ABS_Y);
  const maxWorldDyJump = opts.maxWorldDyJump ?? DEFAULT_MAX_WORLD_DY_JUMP;
  const maxAbsSlope = opts.maxAbsSlope ?? DEFAULT_MAX_ABS_SLOPE;

  const segments: Vec2[][] = [];
  const holes: Vec2[] = [];
  startNewSegment(segments);

  let prev: Vec2 | undefined;

  // Ensure consistent stepping direction
  const dir = opts.xMax >= opts.xMin ? 1 : -1;

  for (
    let x = opts.xMin;
    dir > 0 ? x <= opts.xMax : x >= opts.xMax;
    x += stepUnits * dir
  ) {
    const result = evaluateCompiledAt(compiled, x, { maxAbsValue: opts.maxAbsYUnits });
    const isInvalidResult = !result.ok;
    if (isInvalidResult) {
      prev = undefined;
      startNewSegment(segments);
      continue;
    }

    const y = result.value;
    if (!Number.isFinite(y) || Math.abs(y) > maxWorldAbsY) {
      prev = undefined;
      startNewSegment(segments);
      continue;
    }

    const p: Vec2 = { x, y };
    if (!isValidSamplePoint(p, maxWorldAbsY)) {
      prev = undefined;
      startNewSegment(segments);
      continue;
    }

    if (prev) {
      const dy = Math.abs(p.y - prev.y);
      const dx = Math.abs(p.x - prev.x);
      const slope = dx > 1e-12 ? dy / dx : Number.POSITIVE_INFINITY;

      // Prevent vertical connectors for step-like jumps (e.g. floor/ceil) at the same x.
      const isSameXJump = dx <= SAME_X_EPSILON && dy > SAME_X_JUMP_THRESHOLD;

      if (isSameXJump || dy > maxWorldDyJump || slope > maxAbsSlope) {
        // Break the polyline at asymptotes/discontinuities; do not connect prev to current.
        // Both points are finite here, so this may represent a removable discontinuity.
        pushHole(holes, prev);
        pushHole(holes, p);
        prev = undefined;
        startNewSegment(segments);
      }
    }

    if (!prev) {
      // Ensure segment exists
      if (segments.length === 0) startNewSegment(segments);
      pushPoint(segments, p);
      prev = p;
      continue;
    }

    pushPoint(segments, p);
    prev = p;
  }

  // Remove empty segments
  return {
    segments: segments.filter((s) => s.length > 0),
    holes,
  };
}

export function sampleCompiledFunction(compiled: CompiledExpression, opts: SamplingOptions): ReadonlyArray<GraphSegment> {
  return sampleCompiledFunctionDetailed(compiled, opts).segments;
}
