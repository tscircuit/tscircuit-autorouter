import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"

export type InitiallyConnectedZeroWeightEdge = {
  from: ConnectionPoint
  to: ConnectionPoint
  weight: 0
}

export const getInitiallyConnectedZeroWeightEdges = (
  connection: SimpleRouteConnection,
  initiallyConnectedMap: ConnectivityMap,
): InitiallyConnectedZeroWeightEdge[] => {
  const pointsByInitiallyConnectedNet = new Map<string, ConnectionPoint[]>()

  for (const point of connection.pointsToConnect) {
    if (!point.pointId) continue
    const initiallyConnectedNet = initiallyConnectedMap.getNetConnectedToId(
      point.pointId,
    )
    if (!initiallyConnectedNet) continue
    const points =
      pointsByInitiallyConnectedNet.get(initiallyConnectedNet) ?? []
    points.push(point)
    pointsByInitiallyConnectedNet.set(initiallyConnectedNet, points)
  }

  const zeroWeightEdges: InitiallyConnectedZeroWeightEdge[] = []
  for (const points of pointsByInitiallyConnectedNet.values()) {
    const representativePoint = points[0]
    if (!representativePoint) continue
    for (const point of points.slice(1)) {
      zeroWeightEdges.push({ from: representativePoint, to: point, weight: 0 })
    }
  }

  return zeroWeightEdges
}
