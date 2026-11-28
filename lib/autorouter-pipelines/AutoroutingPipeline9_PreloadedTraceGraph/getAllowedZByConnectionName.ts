import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Resolve per-connection allowed z-layer sets declared on `SimpleRouteJson.buses`. */
export function getAllowedZByConnectionName(
  srj: Pick<SimpleRouteJson, "buses" | "layerCount">,
  connections: readonly SimpleRouteConnection[],
): ReadonlyMap<string, ReadonlySet<number>> {
  const entries: Array<[string, ReadonlySet<number>]> = []
  const busAllowedZPairs: Array<[string, ReadonlySet<number>]> = []

  for (const bus of srj.buses ?? []) {
    if (!bus.allowedLayers?.length) continue
    const allowedZ = new Set(
      bus.allowedLayers.map((layer) => mapLayerNameToZ(layer, srj.layerCount)),
    )
    for (const connectionName of bus.connectionNames) {
      busAllowedZPairs.push([connectionName, allowedZ])
    }
  }
  if (busAllowedZPairs.length === 0) return new Map(entries)

  const directMap = new Map(busAllowedZPairs)
  for (const [name, allowedZ] of busAllowedZPairs) {
    entries.push([name, allowedZ])
  }

  for (const connection of connections) {
    const candidates = [
      connection.name,
      connection.rootConnectionName,
      ...(connection.__rootConnectionNames ?? []),
    ].filter((name): name is string => typeof name === "string")
    let intersected: Set<number> | undefined
    for (const candidate of candidates) {
      const candidateSet = directMap.get(candidate)
      if (!candidateSet) continue
      if (!intersected) {
        intersected = new Set(candidateSet)
      } else {
        for (const z of [...intersected]) {
          if (!candidateSet.has(z)) intersected.delete(z)
        }
      }
    }
    if (intersected) {
      entries.push([connection.name, intersected])
    }
  }

  return new Map(entries)
}
