import type { Obstacle } from "srj-types/capacity-obstacle-types";

/**
 * Returns a new Obstacle whose dimensions are expanded by `inflation` on every
 * side (i.e. width/height grow by 2×inflation, radius grows by inflation).
 *
 * All dimension fields are optional on the source type, so we fall back to 0
 * for any that are absent and only write back the field when the source had it.
 */
export function inflateObstacle(
  obstacle: Obstacle,
  inflation: number,
): Obstacle {
  if (inflation === 0) return obstacle;

  const inflated: Obstacle = { ...obstacle };

  if (obstacle.width !== undefined) {
    inflated.width = obstacle.width + 2 * inflation;
  }

  if (obstacle.height !== undefined) {
    inflated.height = obstacle.height + 2 * inflation;
  }

  if (obstacle.radius !== undefined) {
    inflated.radius = obstacle.radius + inflation;
  }

  return inflated;
}

/**
 * Inflates an obstacle to account for trace clearance.
 *
 * The required keep-out margin on each side equals half the trace width plus
 * the per-net clearance value:
 *
 *   inflation = traceWidth / 2 + clearance
 *
 * @param obstacle   The original (un-inflated) obstacle.
 * @param traceWidth Resolved trace width in mm.
 * @param clearance  Minimum clearance between trace edge and obstacle edge (mm).
 *                   Defaults to 0 when not supplied.
 */
export function inflateObstacleForTrace(
  obstacle: Obstacle,
  traceWidth: number,
  clearance = 0,
): Obstacle {
  if (traceWidth < 0) {
    throw new RangeError(`traceWidth must be ≥ 0, got ${traceWidth}`);
  }
  if (clearance < 0) {
    throw new RangeError(`clearance must be ≥ 0, got ${clearance}`);
  }

  const inflation = traceWidth / 2 + clearance;
  return inflateObstacle(obstacle, inflation);
}
