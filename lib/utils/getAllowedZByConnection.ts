import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { getConnectionPointLayers } from "lib/types"
import { getUniqueValidZLayersFromLayerNames } from "./mapLayerNameToZ"

export type AllowedZByConnection = ReadonlyMap<
  SimpleRouteConnection["name"],
  readonly number[]
>

export function getAllowedZByConnection(
  srj: SimpleRouteJson,
): AllowedZByConnection {
  const allowedZByConnection = new Map<SimpleRouteConnection["name"], number[]>()
  for (const connection of srj.connections) {
    const connectionNames = new Set([
      connection.name,
      ...(connection.__rootConnectionNames ?? []),
      ...(connection.mergedConnectionNames ?? []),
    ])
    if (connection.rootConnectionName !== undefined) {
      connectionNames.add(connection.rootConnectionName)
    }
    let allowedZ: number[] | undefined
    for (const bus of srj.buses ?? []) {
      if (bus.allowedLayers === undefined) continue
      if (!bus.connectionNames.some((name) => connectionNames.has(name))) {
        continue
      }
      const busAllowedZ = getUniqueValidZLayersFromLayerNames(
        bus.allowedLayers,
        srj.layerCount,
      )
      if (allowedZ === undefined) allowedZ = busAllowedZ
      else allowedZ = allowedZ.filter((z) => busAllowedZ.includes(z))
    }
    if (allowedZ === undefined) continue
    if (allowedZ.length === 0) {
      throw new Error("Bus routing restrictions have no common board layer")
    }
    for (const point of connection.pointsToConnect) {
      const terminalZ = getUniqueValidZLayersFromLayerNames(
        getConnectionPointLayers(point),
        srj.layerCount,
      )
      if (!terminalZ.some((z) => allowedZ.includes(z))) {
        throw new Error("Bus routing restrictions exclude a connection terminal")
      }
    }
    allowedZByConnection.set(connection.name, allowedZ)
  }
  return allowedZByConnection
}
