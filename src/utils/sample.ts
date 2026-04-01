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
  maxWorldDyJump?: number;
  maxAbsSlope?: number;
};

const DEFAULT_MAX_WORLD_DY_JUMP = 5;
const DEFAULT_MAX_ABS_SLOPE = 14;

function pushPoint(segments: Vec2[][], p: Vec2) {
  const lastSegment = segments[segments.length - 1];
  if (lastSegment) lastSegment.push(p);
}

function startNewSegment(segments: Vec2[][]) {
  segments.push([]);
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
export function sampleCompiledFunction(compiled: CompiledExpression, opts: SamplingOptions): ReadonlyArray<GraphSegment> {
  const stepUnits = Math.max(0.0005, opts.stepPx / opts.scale);
  const maxWorldDyJump = opts.maxWorldDyJump ?? DEFAULT_MAX_WORLD_DY_JUMP;
  const maxAbsSlope = opts.maxAbsSlope ?? DEFAULT_MAX_ABS_SLOPE;

  const segments: Vec2[][] = [];
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
    if (!result.ok) {
      prev = undefined;
      startNewSegment(segments);
      continue;
    }

    const y = result.value;
    if (!Number.isFinite(y) || Math.abs(y) > opts.maxAbsYUnits) {
      prev = undefined;
      startNewSegment(segments);
      continue;
    }

    const p: Vec2 = { x, y };

    if (prev) {
      const dy = Math.abs(p.y - prev.y);
      const dx = Math.abs(p.x - prev.x);
      const slope = dx > 1e-12 ? dy / dx : Number.POSITIVE_INFINITY;

      if (dy > maxWorldDyJump || slope > maxAbsSlope) {
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
  return segments.filter((s) => s.length > 0);
}
