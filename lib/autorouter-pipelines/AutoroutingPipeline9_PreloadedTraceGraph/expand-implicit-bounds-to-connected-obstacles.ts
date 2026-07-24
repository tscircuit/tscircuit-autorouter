import { getBoundingBox } from "@tscircuit/math-utils"
import type { SimpleRouteJson } from "lib/types"

export const expandImplicitBoundsToConnectedObstacles = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  if (srj.outline && srj.outline.length >= 3) {
    return srj
  }

  const bounds = { ...srj.bounds }
  for (const obstacle of srj.obstacles) {
    const hasConnectivity =
      (obstacle.connectedTo?.length ?? 0) > 0 ||
      (obstacle.offBoardConnectsTo?.length ?? 0) > 0 ||
      obstacle.netIsAssignable === true
    if (!hasConnectivity) continue
    const obstacleBounds = getBoundingBox(obstacle)
    bounds.minX = Math.min(bounds.minX, obstacleBounds.minX)
    bounds.maxX = Math.max(bounds.maxX, obstacleBounds.maxX)
    bounds.minY = Math.min(bounds.minY, obstacleBounds.minY)
    bounds.maxY = Math.max(bounds.maxY, obstacleBounds.maxY)
  }

  return { ...srj, bounds }
}
