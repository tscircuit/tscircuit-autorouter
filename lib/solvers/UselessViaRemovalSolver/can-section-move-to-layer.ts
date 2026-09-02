import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import type { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { RouteSection } from "./route-section"

export const canSectionMoveToLayer = ({
  currentSection,
  targetZ,
  route,
  hdRouteSHI,
  obstacleSHI,
  connMap,
  defaultTraceThickness,
  obstacleMargin,
  traceMargin,
  shouldCheckStaticGeometryForSegment,
}: {
  currentSection: RouteSection
  targetZ: number
  route: HighDensityRoute
  hdRouteSHI: Pick<
    HighDensityRouteSpatialIndex,
    "getConflictingRoutesForSegment"
  >
  obstacleSHI: ObstacleSpatialHashIndex
  connMap: ConnectivityMap
  defaultTraceThickness: number
  obstacleMargin: number
  traceMargin?: number
  shouldCheckStaticGeometryForSegment?: (
    start: RouteSection["points"][number],
    end: RouteSection["points"][number],
  ) => boolean
}): boolean => {
  const currentTraceThickness = route.traceThickness ?? defaultTraceThickness
  const minTraceMargin = traceMargin ?? 0
  const routeIds = [route.connectionName, route.rootConnectionName].filter(
    (id): id is string => id !== undefined,
  )

  for (let i = 0; i < currentSection.points.length - 1; i++) {
    const A = { ...currentSection.points[i], z: targetZ }
    const B = { ...currentSection.points[i + 1], z: targetZ }
    const conflictingRoutes = hdRouteSHI.getConflictingRoutesForSegment(
      A,
      B,
      currentTraceThickness / 2 + minTraceMargin,
    )

    for (const { conflictingRoute, distance } of conflictingRoutes) {
      const conflictingRouteIds = [
        conflictingRoute.connectionName,
        conflictingRoute.rootConnectionName,
      ].filter((id): id is string => id !== undefined)
      const conflictingRouteIsSameNet = routeIds.some((routeId) =>
        conflictingRouteIds.some(
          (conflictingRouteId) =>
            conflictingRouteId === routeId ||
            connMap.areIdsConnected(conflictingRouteId, routeId),
        ),
      )
      if (conflictingRouteIsSameNet) continue

      const otherTraceThickness =
        conflictingRoute.traceThickness ?? defaultTraceThickness
      const otherCopperRadius =
        minTraceMargin > 0
          ? Math.max(otherTraceThickness / 2, conflictingRoute.viaDiameter / 2)
          : otherTraceThickness / 2
      const minDistance =
        currentTraceThickness / 2 + otherCopperRadius + minTraceMargin
      if (distance < minDistance) return false
    }

    if (shouldCheckStaticGeometryForSegment?.(A, B) === false) continue

    const segmentBox = {
      centerX: (A.x + B.x) / 2,
      centerY: (A.y + B.y) / 2,
      width: Math.abs(A.x - B.x),
      height: Math.abs(A.y - B.y),
    }
    const searchMargin = currentTraceThickness / 2 + obstacleMargin
    const obstacles = obstacleSHI.searchArea(
      segmentBox.centerX,
      segmentBox.centerY,
      segmentBox.width + searchMargin * 2,
      segmentBox.height + searchMargin * 2,
    )

    for (const obstacle of obstacles) {
      if (!obstacle.__zLayers) {
        throw new Error("Via removal requires normalized obstacle layers")
      }
      if (!obstacle.__zLayers.includes(targetZ)) continue

      // Same-net pads and copper should not block via removal collision checks.
      const obstacleIsSameNet = routeIds.some((routeId) =>
        obstacle.connectedTo.some(
          (connectedId) =>
            connectedId === routeId ||
            connMap.areIdsConnected(connectedId, routeId),
        ),
      )
      if (obstacleIsSameNet) continue

      const distToObstacle = segmentToBoxMinDistance(A, B, obstacle)
      if (distToObstacle < searchMargin) return false
    }
  }

  return true
}
