import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"
import { areIdsInitiallyConnected } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getInitiallyConnectedZeroWeightEdges } from "./get-initially-connected-zero-weight-edges"

type ZeroWeightEdge = {
  from: ConnectionPoint
  to: ConnectionPoint
  weight: 0
}

export const getInitiallyConnectedStateForConnection = (
  connection: SimpleRouteConnection,
  initiallyConnectedMap: ConnectivityMap,
): {
  zeroWeightEdges: ZeroWeightEdge[]
  arePointsConnected: (
    first: ConnectionPoint,
    second: ConnectionPoint,
  ) => boolean
} => {
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
