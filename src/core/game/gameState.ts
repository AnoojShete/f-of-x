import type { Vec2 } from '../../types';
import { checkGoalCollision, collectStars } from '../../utils/collision';
import type { Star } from '../../utils/collision';

export type LevelCompleteResult = {
  success: true;
  starsCollected: number;
  totalStars: number;
};

export type GameStateSnapshot = {
  collectedIds: ReadonlySet<string>;
  goalReached: boolean;
};

export type GameStateStepParams = {
  ballPosition: Vec2;
  stars: ReadonlyArray<Star>;
  starThreshold: number;
  goal: Vec2 | undefined;
  goalThreshold: number;
  snapshot: GameStateSnapshot;
};

export type GameStateStepResult = {
  collectedIds: ReadonlySet<string>;
  newlyCollectedIds: ReadonlyArray<string>;
  goalReached: boolean;
  completed: boolean;
  levelResult?: LevelCompleteResult;
};

export function stepGameState(params: GameStateStepParams): GameStateStepResult {
  const { ballPosition, stars, starThreshold, goal, goalThreshold, snapshot } = params;

  const nextCollected = new Set(snapshot.collectedIds);
  const { newlyCollectedIds } = collectStars(ballPosition, stars, nextCollected, starThreshold);
  for (const id of newlyCollectedIds) {
    nextCollected.add(id);
  }

  const didReachGoal = !!goal && !snapshot.goalReached && checkGoalCollision(ballPosition, goal, goalThreshold);
  const nextGoalReached = snapshot.goalReached || didReachGoal;

  if (didReachGoal) {
    return {
      collectedIds: nextCollected,
      newlyCollectedIds,
      goalReached: nextGoalReached,
      completed: true,
      levelResult: {
        success: true,
        starsCollected: nextCollected.size,
        totalStars: stars.length,
      },
    };
  }

  return {
    collectedIds: nextCollected,
    newlyCollectedIds,
    goalReached: nextGoalReached,
    completed: false,
  };
}
