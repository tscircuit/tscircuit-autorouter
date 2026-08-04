import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { areIdsInitiallyConnected } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getInitiallyConnectedZeroWeightEdges } from "./get-initially-connected-zero-weight-edges"

type ZeroWeightEdge = {
  from: ConnectionPoint
  to: ConnectionPoint
  weight: 0
}

export const getInitiallyConnectedStateForConnection = (
  connection: SimpleRouteConnection,
  srj: SimpleRouteJson,
  initiallyConnectedMap?: ConnectivityMap,
): {
  zeroWeightEdges: ZeroWeightEdge[]
  arePointsConnected: (
    first: ConnectionPoint,
    second: ConnectionPoint,
  ) => boolean
} => {
  if (initiallyConnectedMap) {
    return {
      zeroWeightEdges: getInitiallyConnectedZeroWeightEdges(
        connection,
        initiallyConnectedMap,
      ),
      arePointsConnected: (first, second) =>
        Boolean(
          first.pointId &&
            second.pointId &&
            areIdsInitiallyConnected(
              initiallyConnectedMap,
              first.pointId,
              second.pointId,
            ),
        ),
    }
  }

  const connectionPointIds = new Set(
    connection.pointsToConnect.flatMap((point) =>
      point.pointId ? [point.pointId] : [],
    ),
  )
  const routedTraceGroups = (srj.traces ?? []).flatMap((trace) => {
    const connectedPointIds = (trace.connectsTo ?? []).filter((pointId) =>
      connectionPointIds.has(pointId),
    )
    return connectedPointIds.length >= 2 ? [connectedPointIds] : []
  })
  const initiallyConnectedGroups = [
    ...(connection.externallyConnectedPointIds ?? []),
    ...routedTraceGroups,
  ]
  const pointById = new Map(
    connection.pointsToConnect.flatMap((point) =>
      point.pointId ? ([[point.pointId, point]] as const) : [],
    ),
  )
  const pointIdToGroup = new Map<string, number>()
  const zeroWeightEdges: ZeroWeightEdge[] = []

  initiallyConnectedGroups.forEach((group, groupIndex) => {
    const points = group.flatMap((pointId) => {
      const point = pointById.get(pointId)
      return point ? [point] : []
    })
    for (const point of points) {
      pointIdToGroup.set(point.pointId!, groupIndex)
    }
    const representativePoint = points[0]
    if (!representativePoint) return
    for (const point of points.slice(1)) {
      zeroWeightEdges.push({ from: representativePoint, to: point, weight: 0 })
    }
  })

  return {
    zeroWeightEdges,
    arePointsConnected: (first, second) => {
      if (!first.pointId || !second.pointId) return false
      const firstGroup = pointIdToGroup.get(first.pointId)
      return (
        firstGroup !== undefined &&
        firstGroup === pointIdToGroup.get(second.pointId)
      )
    },
  }
}
