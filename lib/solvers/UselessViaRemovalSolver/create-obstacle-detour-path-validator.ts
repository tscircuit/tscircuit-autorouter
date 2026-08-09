import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import type { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

export const createObstacleDetourPathValidator = ({
  targetZ,
  route,
  hdRouteSHI,
  obstacleSHI,
  connMap,
  defaultTraceThickness,
  obstacleMargin,
  traceMargin,
  useNumericSegmentKeys,
}: {
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
  traceMargin: number
  useNumericSegmentKeys: boolean
}) => {
  const currentTraceThickness = route.traceThickness ?? defaultTraceThickness
  const routeSearchMargin = currentTraceThickness / 2 + traceMargin
  const obstacleSearchMargin = currentTraceThickness / 2 + obstacleMargin
  const routeConnectionName = route.connectionName
  const routeRootConnectionName = route.rootConnectionName
  const segmentClearanceCache = new Map<string | number, boolean>()
  const obstacleIsSameNetCache = new WeakMap<object, boolean>()
  const routeIsSameNetCache = new WeakMap<object, boolean>()
  const pointIdsByX = useNumericSegmentKeys
    ? new Map<number, Map<number, number>>()
    : undefined
  let nextPointId = 0

  const getPointId = (point: RoutePoint): number => {
    let pointIdsByY = pointIdsByX!.get(point.x)
    if (!pointIdsByY) {
      pointIdsByY = new Map<number, number>()
      pointIdsByX!.set(point.x, pointIdsByY)
    }
    let pointId = pointIdsByY.get(point.y)
    if (pointId === undefined) {
      pointId = nextPointId++
      pointIdsByY.set(point.y, pointId)
    }
    return pointId
  }

  const getSegmentClearanceCacheKey = (
    start: RoutePoint,
    end: RoutePoint,
  ): string | number => {
    if (useNumericSegmentKeys) {
      const startId = getPointId(start)
      const endId = getPointId(end)
      const highId = Math.max(startId, endId)
      const lowId = Math.min(startId, endId)
      return (highId * (highId + 1)) / 2 + lowId
    }

    const startFirst =
      start.x < end.x || (start.x === end.x && start.y <= end.y)
    return startFirst
      ? `${start.x}:${start.y}|${end.x}:${end.y}`
      : `${end.x}:${end.y}|${start.x}:${start.y}`
  }

  const isConnectedToRoute = (connectedId: string): boolean =>
    connectedId === routeConnectionName ||
    connMap.areIdsConnected(connectedId, routeConnectionName) ||
    (routeRootConnectionName !== undefined &&
      (connectedId === routeRootConnectionName ||
        connMap.areIdsConnected(connectedId, routeRootConnectionName)))

  return (
    path: readonly RoutePoint[],
    firstSegmentIndex: number,
  ): boolean => {
    const segmentCount = path.length - 1
    for (let orderIndex = 0; orderIndex < segmentCount; orderIndex++) {
      const naturalIndex = orderIndex - 1
      const index =
        firstSegmentIndex === 0
          ? orderIndex
          : orderIndex === 0
            ? firstSegmentIndex
            : naturalIndex >= firstSegmentIndex
              ? naturalIndex + 1
              : naturalIndex
      const pathStart = path[index]
      const pathEnd = path[index + 1]
      const segmentCacheKey = getSegmentClearanceCacheKey(pathStart, pathEnd)

      const cachedClearance = segmentClearanceCache.get(segmentCacheKey)
      if (cachedClearance !== undefined) {
        if (!cachedClearance) return false
        continue
      }

      // Generated detour points are already on targetZ. Keep this fallback so
      // the validator stays correct for synthetic and externally supplied paths.
      const A =
        pathStart.z === targetZ ? pathStart : { ...pathStart, z: targetZ }
      const B = pathEnd.z === targetZ ? pathEnd : { ...pathEnd, z: targetZ }

      const segmentBox = {
        centerX: (A.x + B.x) / 2,
        centerY: (A.y + B.y) / 2,
        width: Math.abs(A.x - B.x),
        height: Math.abs(A.y - B.y),
      }
      const obstacles = obstacleSHI.searchArea(
        segmentBox.centerX,
        segmentBox.centerY,
        segmentBox.width + obstacleSearchMargin * 2,
        segmentBox.height + obstacleSearchMargin * 2,
      )

      for (const obstacle of obstacles) {
        let obstacleIsSameNet = obstacleIsSameNetCache.get(obstacle)
        if (obstacleIsSameNet === undefined) {
          obstacleIsSameNet = obstacle.connectedTo.some(isConnectedToRoute)
          obstacleIsSameNetCache.set(obstacle, obstacleIsSameNet)
        }
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
        if (distToObstacle < obstacleSearchMargin) {
          segmentClearanceCache.set(segmentCacheKey, false)
          return false
        }
      }

      const conflictingRoutes = hdRouteSHI.getConflictingRoutesForSegment(
        A,
        B,
        routeSearchMargin,
      )
      for (const { conflictingRoute, distance } of conflictingRoutes) {
        let conflictingRouteIsSameNet =
          routeIsSameNetCache.get(conflictingRoute)
        if (conflictingRouteIsSameNet === undefined) {
          conflictingRouteIsSameNet =
            isConnectedToRoute(conflictingRoute.connectionName) ||
            (conflictingRoute.rootConnectionName !== undefined &&
              isConnectedToRoute(conflictingRoute.rootConnectionName))
          routeIsSameNetCache.set(
            conflictingRoute,
            conflictingRouteIsSameNet,
          )
        }
        if (conflictingRouteIsSameNet) continue

        const otherTraceThickness =
          conflictingRoute.traceThickness ?? defaultTraceThickness
        const otherCopperRadius = Math.max(
          otherTraceThickness / 2,
          conflictingRoute.viaDiameter / 2,
        )
        const minDistance =
          currentTraceThickness / 2 + otherCopperRadius + traceMargin
        if (distance < minDistance) {
          segmentClearanceCache.set(segmentCacheKey, false)
          return false
        }
      }

      segmentClearanceCache.set(segmentCacheKey, true)
    }
    return true
  }
}
