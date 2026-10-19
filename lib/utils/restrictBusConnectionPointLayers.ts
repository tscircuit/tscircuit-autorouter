import type { SimpleRouteJson } from "lib/types"
import { getAllowedZByConnection } from "./getAllowedZByConnection"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

export function restrictBusConnectionPointLayers(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  const allowedZByConnection = getAllowedZByConnection(srj)
  if (allowedZByConnection.size === 0) return srj
  return {
    ...srj,
    connections: srj.connections.map((connection) => {
      const allowedZ = allowedZByConnection.get(connection.name)
      if (!allowedZ) return connection
      return {
        ...connection,
        pointsToConnect: connection.pointsToConnect.map((point) => {
          if (point.layers === undefined) return point
          return {
            ...point,
            layers: point.layers.filter((layer) =>
              allowedZ.includes(mapLayerNameToZ(layer, srj.layerCount)),
            ),
          }
        }),
      }
    }),
  }
}
