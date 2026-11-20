import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { getUniqueValidZLayersFromLayerNames } from "./mapLayerNameToZ"

type ConnectionName = SimpleRouteConnection["name"]
export type AllowedLayersByConnection = ReadonlyMap<
  ConnectionName,
  ReadonlySet<number>
>

export function getAllowedLayersByConnection(
  srj: SimpleRouteJson,
): AllowedLayersByConnection {
  const restrictions = new Map<ConnectionName, ReadonlySet<number>>()
  for (const bus of srj.buses ?? []) {
    if (bus.allowedLayers === undefined) continue
    const layers = getUniqueValidZLayersFromLayerNames(
      bus.allowedLayers,
      srj.layerCount,
    )
    for (const name of bus.connectionNames) {
      const previous = restrictions.get(name)
      restrictions.set(
        name,
        new Set(layers.filter((z) => !previous || previous.has(z))),
      )
    }
  }
  const result = new Map(restrictions)
  for (const connection of srj.connections) {
    const names = [connection.name, ...(connection.__rootConnectionNames ?? [])]
    const limits = names.flatMap((name) => {
      const layers = restrictions.get(name)
      return layers ? [layers] : []
    })
    if (limits.length === 0) continue
    const layers = new Set(
      [...limits[0]!].filter((z) => limits.every((limit) => limit.has(z))),
    )
    if (layers.size === 0) {
      throw new Error(
        `Connection "${connection.name}" has no allowed bus routing layers`,
      )
    }
    result.set(connection.name, layers)
  }
  return result
}
