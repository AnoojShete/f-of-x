import type { Vec2 } from '../../../shared/types';

export type Goal = Vec2;

export type Star = Vec2 & {
  id: string;
};

export type StarCollisionResult = {
  newlyCollectedIds: ReadonlyArray<string>;
};

export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function isWithinThreshold(a: Vec2, b: Vec2, threshold: number): boolean {
  return distance(a, b) <= threshold;
}

export function checkGoalCollision(ballPosition: Vec2, goal: Goal, threshold: number): boolean {
  return isWithinThreshold(ballPosition, goal, threshold);
}

/**
 * Returns ids of stars that were newly collected this tick.
 *
 * This is a pure function: callers own the collected-set storage.
 */
export function collectStars(
  ballPosition: Vec2,
  stars: ReadonlyArray<Star>,
  collectedIds: ReadonlySet<string>,
  threshold: number
): StarCollisionResult {
  if (stars.length === 0) return { newlyCollectedIds: [] };

  const newlyCollected: string[] = [];
  for (const star of stars) {
    if (collectedIds.has(star.id)) continue;
    if (isWithinThreshold(ballPosition, star, threshold)) {
      newlyCollected.push(star.id);
    }
  }

  return { newlyCollectedIds: newlyCollected };
}
