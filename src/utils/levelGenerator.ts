import type { Vec2 } from '../types';

export type LevelType = 'sine' | 'cosine';

export type GeneratedLevel = {
  start: Vec2;
  stars: ReadonlyArray<Vec2>;
  goal: Vec2;
  solution: string;
};

type LevelBuilder = () => GeneratedLevel;

function createLevel(solution: string, basePoints: readonly [Vec2, Vec2, Vec2, Vec2, Vec2], goal: Vec2): GeneratedLevel {
  const start = basePoints[0];
  const stars = [basePoints[1], basePoints[2], basePoints[3]] as const;
  const lastStar = stars[stars.length - 1]!;

  // Keep goal no higher than the last star to avoid impossible climbs with friction.
  const reachableGoal: Vec2 = {
    x: goal.x,
    y: Math.min(goal.y, lastStar.y),
  };

  return {
    start,
    stars,
    goal: reachableGoal,
    solution,
  };
}

const LEVEL_BUILDERS: Record<LevelType, LevelBuilder> = {
  sine: () => {
    const basePoints = [
      { x: -Math.PI, y: 0 },
      { x: -Math.PI / 2, y: -1 },
      // Slight offset keeps the level recognizable but prevents a pure template copy.
      { x: 0, y: 0.3 },
      { x: Math.PI / 2, y: 1 },
      { x: Math.PI, y: 0 },
    ] as const;

    return createLevel('sin(x)', basePoints, {
      x: Math.PI * 0.8,
      y: 0.2,
    });
  },

  cosine: () => {
    const basePoints = [
      { x: -Math.PI, y: -1 },
      { x: -Math.PI / 2, y: 0 },
      { x: 0, y: 1 },
      // Small perturbation adds challenge while preserving overall cosine structure.
      { x: Math.PI / 2, y: 0.25 },
      { x: Math.PI, y: -1 },
    ] as const;

    return createLevel('cos(x)', basePoints, {
      x: Math.PI * 0.8,
      y: -0.4,
    });
  },
};

export function generateLevel(levelType: LevelType): GeneratedLevel {
  const builder = LEVEL_BUILDERS[levelType];
  return builder();
}
