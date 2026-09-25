import type { Obstacle, SimpleRouteJson } from "lib/types"

/**
 * Build routing-only clearance envelopes around NPTHs. Keep the physical SRJ
 * separately: these envelopes must never become larger fabrication drill holes.
 * Apply once, before preprocessing, and use throughout repair and expansion too.
 */
export function createSrjWithHoleClearance(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  const clearance = srj.minTraceToHoleClearance
  if (clearance === undefined) return srj
  if (!Number.isFinite(clearance) || clearance < 0) {
    throw new Error(
      "minTraceToHoleClearance must be a finite non-negative distance in mm",
    )
  }

  return {
    ...srj,
    obstacles: srj.obstacles.map((obstacle, index): Obstacle => {
      if (!obstacle.isHole) return obstacle
      const name = obstacle.obstacleId ?? `obstacles[${index}]`
      if (obstacle.connectedTo.length > 0) {
        throw new Error(
          `Non-plated hole ${name} must have an empty connectedTo array`,
        )
      }
      if (
        !Number.isFinite(obstacle.width) ||
        obstacle.width <= 0 ||
        !Number.isFinite(obstacle.height) ||
        obstacle.height <= 0 ||
        !Number.isFinite(obstacle.center.x) ||
        !Number.isFinite(obstacle.center.y) ||
        (obstacle.ccwRotationDegrees !== undefined &&
          !Number.isFinite(obstacle.ccwRotationDegrees)) ||
        (obstacle.shape === "circle" && obstacle.width !== obstacle.height)
      ) {
        throw new Error(`Non-plated hole ${name} has invalid geometry`)
      }
      return {
        ...obstacle,
        width: obstacle.width + 2 * clearance,
        height: obstacle.height + 2 * clearance,
        // Circle orientation has no geometric effect; do not slice it as a rotated rectangle.
        ...(obstacle.shape === "circle"
          ? { ccwRotationDegrees: undefined }
          : {}),
      }
    }),
  }
}
