import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { AllowedZByConnectionName } from "lib/types/high-density-types"
import type { ConnectionName } from "lib/types/srj-types"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"

export const getPipeline9AllowedZByConnectionName = ({
  srj,
  connections,
}: {
  srj: SimpleRouteJson
  connections: SimpleRouteConnection[]
}): AllowedZByConnectionName => {
  const busAllowedZByConnectionName = new Map<ConnectionName, number[][]>()
  for (const bus of srj.buses ?? []) {
    if (!bus.allowedLayers) continue
    const allowedZ = getUniqueValidZLayersFromLayerNames(
      bus.allowedLayers,
      srj.layerCount,
    )
    if (allowedZ.length === 0) {
      throw new Error(`Bus "${bus.busId}" does not allow a valid board layer`)
    }
    for (const connectionName of bus.connectionNames) {
      const constraints = busAllowedZByConnectionName.get(connectionName) ?? []
      constraints.push(allowedZ)
      busAllowedZByConnectionName.set(connectionName, constraints)
    }
  }

  const allowedZByConnectionName: Record<ConnectionName, readonly number[]> = {}
  for (const connection of connections) {
    const rootConnectionNames = new Set([
      connection.name,
      connection.rootConnectionName,
      ...(connection.__rootConnectionNames ?? []),
    ])
    const constraints = [...rootConnectionNames].flatMap((connectionName) =>
      connectionName
        ? (busAllowedZByConnectionName.get(connectionName) ?? [])
        : [],
    )
    if (constraints.length === 0) continue

    const allowedZ = constraints
      .slice(1)
      .reduce(
        (intersection, current) =>
          intersection.filter((z) => current.includes(z)),
        constraints[0]!,
      )
    if (allowedZ.length === 0) {
      throw new Error(
        `Connection "${connection.name}" has incompatible bus layer constraints`,
      )
    }
    allowedZByConnectionName[connection.name] = allowedZ
  }
  return allowedZByConnectionName
}
