import type { SimpleRouteJson } from "lib/types"

/** Validate declared NPTH rules without modifying physical obstacle geometry. */
export function validateHoleClearance(srj: SimpleRouteJson): void {
  const clearance = srj.minTraceToHoleEdgeClearance
  if (clearance === undefined) return
  if (!Number.isFinite(clearance) || clearance < 0) {
    throw new Error(
      "minTraceToHoleEdgeClearance must be a finite non-negative distance in mm",
    )
  }
  for (const [index, obstacle] of srj.obstacles.entries()) {
    if (!obstacle.isHole) continue
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
  }
}
