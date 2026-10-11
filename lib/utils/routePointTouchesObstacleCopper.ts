import type { Obstacle } from "../types"
import type { HighDensityIntraNodeRoute } from "../types/high-density-types"
import { pointToObstacleCopperDistance } from "./pointToObstacleCopperDistance"

const PHYSICAL_CONTACT_ROUNDOFF = 1e-9

/** Proves contact using actual attached wire copper, not a guessed point radius. */
export function routePointTouchesObstacleCopper(
  route: Pick<HighDensityIntraNodeRoute, "route" | "traceThickness">,
  pointIndex: number, obstacle: Obstacle,
): boolean {
  const point = route.route[pointIndex]
  if (!point) return false
  const distance = pointToObstacleCopperDistance(point, obstacle)
  if (distance <= PHYSICAL_CONTACT_ROUNDOFF) return true
  const previous = route.route[pointIndex - 1]
  const next = route.route[pointIndex + 1]
  const incomingWidth = previous && Number.isFinite(previous.x) && Number.isFinite(previous.y) &&
    previous.z === point.z && !previous.toNextSegmentType
    ? previous.traceThickness ?? route.traceThickness : 0
  const outgoingWidth = next && Number.isFinite(next.x) && Number.isFinite(next.y) &&
    next.z === point.z && !point.toNextSegmentType
    ? point.traceThickness ?? route.traceThickness : 0
  return [incomingWidth, outgoingWidth].some((width) => Number.isFinite(width) && width > 0 &&
    distance <= width / 2 + PHYSICAL_CONTACT_ROUNDOFF)
}
