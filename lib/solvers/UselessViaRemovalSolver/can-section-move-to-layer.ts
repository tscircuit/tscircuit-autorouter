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
  segmentOrder,
  segmentClearanceCache,
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
  segmentOrder?: readonly number[]
  /** Reuse only while route geometry and all validation parameters are fixed. */
  segmentClearanceCache?: Map<string, boolean>
}): boolean => {
  const currentTraceThickness = route.traceThickness ?? defaultTraceThickness
  const minTraceMargin = traceMargin ?? 0
  const routeIds = [route.connectionName, route.rootConnectionName].filter(
    (id): id is string => id !== undefined,
  )

  const segmentCount = currentSection.points.length - 1
  for (let orderIndex = 0; orderIndex < segmentCount; orderIndex++) {
    const i = segmentOrder?.[orderIndex] ?? orderIndex
    const A = { ...currentSection.points[i], z: targetZ }
    const B = { ...currentSection.points[i + 1], z: targetZ }
    let segmentCacheKey: string | undefined
    if (segmentClearanceCache) {
      const aKey = `${A.x}:${A.y}:${A.z}`
      const bKey = `${B.x}:${B.y}:${B.z}`
      segmentCacheKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
      const cachedClearance = segmentClearanceCache.get(segmentCacheKey)
      if (cachedClearance !== undefined) {
        if (!cachedClearance) return false
        continue
      }
    }

    if (shouldCheckStaticGeometryForSegment?.(A, B) !== false) {
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
        // Same-net pads and copper should not block via removal collision checks.
        const obstacleIsSameNet = routeIds.some((routeId) =>
          obstacle.connectedTo.some(
            (connectedId) =>
              connectedId === routeId ||
              connMap.areIdsConnected(connectedId, routeId),
          ),
        )
        if (obstacleIsSameNet) continue

        if (obstacle.__zLayers?.includes(targetZ)) {
          const isAtObstacle =
            (Math.abs(A.x - obstacle.center.x) < 0.01 &&
              Math.abs(A.y - obstacle.center.y) < 0.01) ||
            (Math.abs(B.x - obstacle.center.x) < 0.01 &&
              Math.abs(B.y - obstacle.center.y) < 0.01)
          if (isAtObstacle) continue
        }

        const distToObstacle = segmentToBoxMinDistance(A, B, obstacle)
        if (distToObstacle < searchMargin) {
          if (segmentClearanceCache && segmentCacheKey !== undefined) {
            segmentClearanceCache.set(segmentCacheKey, false)
          }
          return false
        }
      }
    }

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
      if (distance < minDistance) {
        if (segmentClearanceCache && segmentCacheKey !== undefined) {
          segmentClearanceCache.set(segmentCacheKey, false)
        }
        return false
      }
    }
    if (segmentClearanceCache && segmentCacheKey !== undefined) {
      segmentClearanceCache.set(segmentCacheKey, true)
    }
  }

  return true
}
