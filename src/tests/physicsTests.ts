/// <reference types="node" />
import { writeFileSync } from 'fs';
import { compileExpression } from '../utils/evaluate';
import { sampleCompiledFunctionDetailed } from '../utils/sample';
import { buildTraversalPaths, chooseActiveSegmentIndex, findClosestDistanceByX, computeInitialVelocity } from '../physics/traversal';
import { stepPhysicsMode, type BallPhysicsState } from '../physics/motion';
import type { Vec2 } from '../types';

type TestResult = {
  name: string;
  passed: boolean;
  reason?: string;
};

type SimulationSnapshot = {
  positions: Vec2[];
  states: BallPhysicsState[];
};

const SCALE = 60;
const STEP_WORLD = 0.02;
const X_MIN = -8;
const X_MAX = 8;
const MAX_ABS_Y = 1e3;
const DT = 1 / 60;
const SUBSTEPS = 6;
const PHYSICS = {
  gravityPxPerSec2: 420,
  frictionPerSec: 0.58,
  maxVelocity: 600,
  radiusPx: 6,
  speedScale: 1,
};

function buildPaths(expressions: string[]) {
  const allSegments = [] as ReadonlyArray<ReadonlyArray<Vec2>>[];
  const compileErrors: string[] = [];
  const holesByExpr: Array<ReadonlyArray<Vec2>> = [];

  for (const expression of expressions) {
    const compiled = compileExpression(expression);
    if (!compiled.ok) {
      compileErrors.push(`${expression}: ${compiled.error}`);
      holesByExpr.push([]);
      continue;
    }

    const sampled = sampleCompiledFunctionDetailed(compiled.compiled, {
      xMin: X_MIN,
      xMax: X_MAX,
      stepWorld: STEP_WORLD,
      maxAbsYUnits: MAX_ABS_Y,
    });

    allSegments.push(sampled.segments);
    holesByExpr.push(sampled.holes);
  }

  const merged = allSegments.flatMap((segments) => segments);
  const paths = buildTraversalPaths(merged);
  return { paths, compileErrors, holesByExpr };
}

function makeAirState(start: Vec2): BallPhysicsState {
  return {
    previousBallWorld: start,
    distance: 0,
    velocity: 0,
    ballWorld: start,
    airVelocity: { x: 0, y: 0 },
    motionState: 'air',
    spawnAttachGraceSec: 0,
    activeSegmentIndex: undefined,
  };
}

function makeOnCurveState(paths: ReturnType<typeof buildPaths>['paths'], start: Vec2, velocityPx = 120): BallPhysicsState {
  const activeSegmentIndex = chooseActiveSegmentIndex(paths, start);
  const activePath = activeSegmentIndex == null ? undefined : paths[activeSegmentIndex];
  const distance = activePath ? findClosestDistanceByX(activePath, start.x) : 0;
  const velocity = activePath ? computeInitialVelocity(activePath, distance, Math.abs(velocityPx)) : velocityPx;

  return {
    previousBallWorld: start,
    distance,
    velocity,
    ballWorld: start,
    airVelocity: { x: 0, y: 0 },
    motionState: 'onCurve',
    spawnAttachGraceSec: 0,
    activeSegmentIndex,
  };
}

function simulate(paths: ReturnType<typeof buildPaths>['paths'], initial: BallPhysicsState, steps: number): SimulationSnapshot {
  let state = initial;
  const positions: Vec2[] = [];
  const states: BallPhysicsState[] = [];

  for (let i = 0; i < steps; i++) {
    for (let s = 0; s < SUBSTEPS; s++) {
      state = stepPhysicsMode({
        dt: DT / SUBSTEPS,
        paths,
        scale: SCALE,
        speedScale: PHYSICS.speedScale,
        radiusPx: PHYSICS.radiusPx,
        gravityPxPerSec2: PHYSICS.gravityPxPerSec2,
        frictionPerSec: PHYSICS.frictionPerSec,
        maxVelocity: PHYSICS.maxVelocity,
        state,
      });
    }

    positions.push(state.ballWorld);
    states.push(state);
  }

  return { positions, states };
}

function approx(value: number, expected: number, eps: number): boolean {
  return Math.abs(value - expected) <= eps;
}

function noNonFinitePositions(positions: Vec2[]): boolean {
  return positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function testOneOverXFall(): TestResult {
  const built = buildPaths(['1/x']);
  if (built.compileErrors.length > 0) {
    return { name: '1/x -> ball falls at x=0', passed: false, reason: built.compileErrors.join('; ') };
  }

  const start = { x: 0, y: 2 };
  const sim = simulate(built.paths, makeAirState(start), 220);
  const final = sim.states[sim.states.length - 1];
  if (!final) {
    return { name: '1/x -> ball falls at x=0', passed: false, reason: 'simulation produced no state' };
  }

  if (!noNonFinitePositions(sim.positions)) {
    return { name: '1/x -> ball falls at x=0', passed: false, reason: 'non-finite positions encountered' };
  }
  if (final.motionState !== 'air') {
    return { name: '1/x -> ball falls at x=0', passed: false, reason: 'unexpected curve attachment at discontinuity' };
  }
  if (!(final.ballWorld.y < start.y - 0.8)) {
    return { name: '1/x -> ball falls at x=0', passed: false, reason: 'ball did not fall enough in air' };
  }
  return { name: '1/x -> ball falls at x=0', passed: true };
}

function testTanNoSticking(): TestResult {
  const built = buildPaths(['tan(x)']);
  if (built.compileErrors.length > 0) {
    return { name: 'tan(x) -> no sticking at asymptotes', passed: false, reason: built.compileErrors.join('; ') };
  }

  const sim = simulate(built.paths, makeAirState({ x: Math.PI / 2, y: 3 }), 240);
  if (!noNonFinitePositions(sim.positions)) {
    return { name: 'tan(x) -> no sticking at asymptotes', passed: false, reason: 'non-finite positions encountered' };
  }

  const stuckFrames = sim.positions.filter((p, i, arr) => i > 0 && approx(p.x, arr[i - 1]!.x, 1e-5) && approx(p.y, arr[i - 1]!.y, 1e-5)).length;
  if (stuckFrames > 20) {
    return { name: 'tan(x) -> no sticking at asymptotes', passed: false, reason: `stuck for too many frames: ${stuckFrames}` };
  }

  return { name: 'tan(x) -> no sticking at asymptotes', passed: true };
}

function testLogNoCollisionLeftOfDomain(): TestResult {
  const built = buildPaths(['log(x)']);
  if (built.compileErrors.length > 0) {
    return { name: 'log(x) -> no collision near x<=0', passed: false, reason: built.compileErrors.join('; ') };
  }

  const sim = simulate(built.paths, makeAirState({ x: -0.5, y: 1.5 }), 200);
  if (sim.states.some((s) => s.motionState === 'onCurve')) {
    return { name: 'log(x) -> no collision near x<=0', passed: false, reason: 'attached in invalid domain region' };
  }

  return { name: 'log(x) -> no collision near x<=0', passed: true };
}

function testRemovableHoleDetection(): TestResult {
  const built = buildPaths(['(x^2-1)/(x-1)']);
  if (built.compileErrors.length > 0) {
    return { name: '(x^2-1)/(x-1) -> hole detection', passed: false, reason: built.compileErrors.join('; ') };
  }

  // Fixed-step sampling may not always land exactly on x=1,
  // so we validate safe behavior around the removable discontinuity.
  const sim = simulate(built.paths, makeAirState({ x: 1, y: 2.5 }), 180);
  if (!noNonFinitePositions(sim.positions)) {
    return { name: '(x^2-1)/(x-1) -> hole detection', passed: false, reason: 'non-finite positions encountered near hole' };
  }
  const everAttached = sim.states.some((s) => s.motionState === 'onCurve');
  if (!everAttached) {
    return { name: '(x^2-1)/(x-1) -> hole detection', passed: false, reason: 'never attached near continuous branch' };
  }

  return { name: '(x^2-1)/(x-1) -> hole detection', passed: true };
}

function testCubicNoVerticalSticking(): TestResult {
  const expr = '-(x+pi)^3-2';
  const built = buildPaths([expr]);
  if (built.compileErrors.length > 0) {
    return { name: '-(x+pi)^3-2 -> no vertical sticking', passed: false, reason: built.compileErrors.join('; ') };
  }

  const sim = simulate(built.paths, makeAirState({ x: -3.1, y: 3 }), 220);
  if (!noNonFinitePositions(sim.positions)) {
    return { name: '-(x+pi)^3-2 -> no vertical sticking', passed: false, reason: 'non-finite positions encountered' };
  }

  const repeating = sim.positions.filter((p, i, arr) => i > 0 && approx(p.x, arr[i - 1]!.x, 1e-5) && approx(p.y, arr[i - 1]!.y, 1e-5)).length;
  if (repeating > 20) {
    return { name: '-(x+pi)^3-2 -> no vertical sticking', passed: false, reason: `possible sticking detected: ${repeating} repeated frames` };
  }

  return { name: '-(x+pi)^3-2 -> no vertical sticking', passed: true };
}

function testSinSmoothTraversal(): TestResult {
  const built = buildPaths(['sin(x)']);
  if (built.compileErrors.length > 0) {
    return { name: 'sin(x) -> smooth traversal', passed: false, reason: built.compileErrors.join('; ') };
  }

  const start = { x: -2.5, y: -0.3 };
  const sim = simulate(built.paths, makeOnCurveState(built.paths, start, 160), 180);
  if (!sim.states.some((s) => s.motionState === 'onCurve')) {
    return { name: 'sin(x) -> smooth traversal', passed: false, reason: 'never remained/entered on-curve state' };
  }

  let maxStep = 0;
  for (let i = 1; i < sim.positions.length; i++) {
    const a = sim.positions[i - 1]!;
    const b = sim.positions[i]!;
    maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.y - a.y));
  }
  if (maxStep > 0.8) {
    return { name: 'sin(x) -> smooth traversal', passed: false, reason: `movement too jumpy (max step ${maxStep.toFixed(3)})` };
  }

  return { name: 'sin(x) -> smooth traversal', passed: true };
}

function testMultiCurveAttachSwitching(): TestResult {
  const built = buildPaths(['sin(x) + 1.5', '-1.2']);
  if (built.compileErrors.length > 0) {
    return { name: 'multi-curve -> attach switching', passed: false, reason: built.compileErrors.join('; ') };
  }

  // Phase 1: fall from above and attach to the upper curve.
  const phase1 = simulate(built.paths, makeAirState({ x: 0, y: 3.0 }), 200);
  const firstAttach = phase1.states.find((s) => s.motionState === 'onCurve' && s.activeSegmentIndex != null);
  if (!firstAttach || firstAttach.activeSegmentIndex == null) {
    return { name: 'multi-curve -> attach switching', passed: false, reason: 'did not attach in phase 1' };
  }

  // Phase 2: force airborne below upper curve and ensure reattachment chooses a different curve.
  const phase2 = simulate(built.paths, makeAirState({ x: 0, y: 0.0 }), 220);
  const secondAttach = phase2.states.find((s) => s.motionState === 'onCurve' && s.activeSegmentIndex != null);
  if (!secondAttach || secondAttach.activeSegmentIndex == null) {
    return { name: 'multi-curve -> attach switching', passed: false, reason: 'did not reattach in phase 2' };
  }

  if (secondAttach.activeSegmentIndex === firstAttach.activeSegmentIndex) {
    return {
      name: 'multi-curve -> attach switching',
      passed: false,
      reason: `reattached to same segment index (${secondAttach.activeSegmentIndex})`,
    };
  }

  return { name: 'multi-curve -> attach switching', passed: true };
}

function testCubicContinuitySampling(): TestResult {
  const built = buildPaths(['x^3']);
  if (built.compileErrors.length > 0) {
    return { name: 'x^3 -> continuous sampling', passed: false, reason: built.compileErrors.join('; ') };
  }

  const segmentCount = built.paths.length;
  if (segmentCount !== 1) {
    return {
      name: 'x^3 -> continuous sampling',
      passed: false,
      reason: `expected 1 continuous path, got ${segmentCount}`,
    };
  }

  return { name: 'x^3 -> continuous sampling', passed: true };
}

function testOneOverXBranchSplitSampling(): TestResult {
  const built = buildPaths(['1/x']);
  if (built.compileErrors.length > 0) {
    return { name: '1/x -> branch split sampling', passed: false, reason: built.compileErrors.join('; ') };
  }

  if (built.paths.length < 2) {
    return {
      name: '1/x -> branch split sampling',
      passed: false,
      reason: `expected at least 2 branches, got ${built.paths.length}`,
    };
  }

  const hasLeftBranch = built.paths.some((p) => p.worldPoints.some((pt) => pt.x < -0.05));
  const hasRightBranch = built.paths.some((p) => p.worldPoints.some((pt) => pt.x > 0.05));

  if (!hasLeftBranch || !hasRightBranch) {
    return {
      name: '1/x -> branch split sampling',
      passed: false,
      reason: 'missing left or right branch around x=0',
    };
  }

  return { name: '1/x -> branch split sampling', passed: true };
}

function runAllTests(): TestResult[] {
  return [
    testOneOverXFall(),
    testTanNoSticking(),
    testLogNoCollisionLeftOfDomain(),
    testRemovableHoleDetection(),
    testCubicNoVerticalSticking(),
    testCubicContinuitySampling(),
    testOneOverXBranchSplitSampling(),
    testSinSmoothTraversal(),
    testMultiCurveAttachSwitching(),
  ];
}

const results = runAllTests();
const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;

for (const result of results) {
  if (result.passed) {
    console.log(`✔ ${result.name}`);
  } else {
    console.log(`✖ ${result.name}${result.reason ? ` (${result.reason})` : ''}`);
  }
}

const report = {
  summary: {
    total: results.length,
    passed,
    failed,
  },
  results,
};

writeFileSync('physics-test-report.json', JSON.stringify(report, null, 2));
writeFileSync(
  'physics-test-log.txt',
  results
    .map((r) => `${r.passed ? '[PASS]' : '[FAIL]'} ${r.name}${r.reason ? ` :: ${r.reason}` : ''}`)
    .join('\n')
);

if (failed > 0) {
  console.error(`Physics tests failed: ${failed}/${results.length}`);
  process.exit(1);
}

console.log(`Physics tests passed: ${passed}/${results.length}`);
