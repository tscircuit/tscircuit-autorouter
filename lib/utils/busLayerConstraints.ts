import {
  getConnectionPointLayers,
  type SimpleRouteConnection,
  type SimpleRouteJson,
  type SimplifiedPcbTraces,
} from "lib/types"
import {
  getUniqueValidZLayersFromLayerNames,
  mapLayerNameToZ,
} from "./mapLayerNameToZ"
import { getConnectivityMapFromSimpleRouteJson } from "./getConnectivityMapFromSimpleRouteJson"

export type AllowedZByConnection = ReadonlyMap<
  SimpleRouteConnection["name"],
  readonly number[]
>

export function getAllowedZByConnection(
  srj: SimpleRouteJson,
): AllowedZByConnection {
  const allowedZByConnection = new Map<SimpleRouteConnection["name"], number[]>()
  for (const bus of srj.buses ?? []) {
    if (bus.allowedLayers === undefined) continue
    const busAllowedZ = getUniqueValidZLayersFromLayerNames(
      bus.allowedLayers,
      srj.layerCount,
    )
    for (const connection of srj.connections) {
      if (!bus.connectionNames.some((name) =>
        name === connection.name ||
        connection.__rootConnectionNames?.includes(name),
      )) {
        continue
      }
      let allowedZ = busAllowedZ
      const previous = allowedZByConnection.get(connection.name)
      if (previous !== undefined) {
        allowedZ = previous.filter((z) => busAllowedZ.includes(z))
      }
      if (allowedZ.length === 0) {
        throw new Error("Bus routing restrictions have no common board layer")
      }
      allowedZByConnection.set(connection.name, allowedZ)
    }
  }
  return allowedZByConnection
}

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
          const layers = getConnectionPointLayers(point).filter((layer) =>
            allowedZ.includes(mapLayerNameToZ(layer, srj.layerCount)),
          )
          if (layers.length === 0) {
            throw new Error(
              "Bus routing restrictions exclude a connection terminal",
            )
          }
          if (point.layers === undefined) return point
          return { ...point, layers }
        }),
      }
    }),
  }
}

export function getBusLayerRoutingError(input: {
  srj: SimpleRouteJson
  traces: Readonly<SimplifiedPcbTraces>
}): string | undefined {
  const allowedZByConnection = getAllowedZByConnection(input.srj)
  if (allowedZByConnection.size === 0) return undefined
  const connMap = getConnectivityMapFromSimpleRouteJson(input.srj)
  for (const trace of input.traces) {
    for (const [connectionName, allowedZ] of allowedZByConnection) {
      if (!connMap.areIdsConnected(trace.connection_name, connectionName)) {
        continue
      }
      const violatesLayerRestriction = trace.route.some(
        (point) => point.route_type === "wire" &&
          !allowedZ.includes(mapLayerNameToZ(point.layer, input.srj.layerCount)),
      )
      if (violatesLayerRestriction) {
        return "Routed signal violates the bus's allowed PCB layers"
      }
    }
  }
  return undefined
}
