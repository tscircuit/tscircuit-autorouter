import { getConnectionPointLayers, type SimpleRouteJson } from "lib/types"
import { DSU } from "./dsu"
import { mapLayerNameToZ } from "./mapLayerNameToZ"
import { mapZToLayerName } from "./mapZToLayerName"

/** Resolve bus wire policies through electrical aliases without limiting vias. */
export function getConnectionAllowedZ(
  srj: SimpleRouteJson,
): Map<string, number[]> {
  const buses = (srj.buses ?? []).filter(
    (bus) => bus.allowedLayers !== undefined,
  )
  if (
    buses.length === 0 &&
    srj.connections.every(
      (connection) => connection.allowedLayers === undefined,
    )
  ) {
    return new Map()
  }
  const aliasGroups: string[][] = []
  const names = new Set<string>()
  const addAliases = (values: Array<string | undefined>): void => {
    const group = values.filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    if (group.length === 0) return
    aliasGroups.push(group)
    for (const name of group) names.add(name)
  }
  for (const connection of srj.connections) {
    if (connection.name.length === 0) {
      throw new Error("Wire layer policies require a named connection")
    }
    addAliases([
      connection.name,
      connection.source_trace_id,
      connection.rootConnectionName,
      connection.__netConnectionName,
      connection.netConnectionName,
      ...(connection.__rootConnectionNames ?? []),
      ...(connection.mergedConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ])
  }
  for (const trace of srj.traces ?? []) {
    addAliases([
      trace.pcb_trace_id,
      trace.connection_name,
      ...(trace.connectsTo ?? []),
    ])
  }
  for (const bus of buses) {
    for (const name of bus.connectionNames) names.add(name)
  }
  const aliases = new DSU([...names])
  for (const group of aliasGroups) {
    for (const name of group) aliases.union(group[0]!, name)
  }
  const policies: Array<{ name: string; layers: string[] }> = buses.flatMap(
    (bus) =>
      bus.connectionNames.map((name) => ({
        name,
        layers: bus.allowedLayers!,
      })),
  )
  for (const connection of srj.connections) {
    if (connection.allowedLayers !== undefined) {
      policies.push({ name: connection.name, layers: connection.allowedLayers })
    }
  }
  const allowedZByRoot = new Map<string, number[]>()
  for (const { name, layers } of policies) {
    const root = aliases.find(name)
    const layerZ = layers.map((layer) => {
      const z = mapLayerNameToZ(layer, srj.layerCount)
      if (
        !Number.isInteger(z) ||
        z < 0 ||
        z >= srj.layerCount ||
        layer !== mapZToLayerName(z, srj.layerCount)
      ) {
        throw new Error(
          `Connection "${name}" has invalid allowed layer "${layer}"`,
        )
      }
      return z
    })
    const previous = allowedZByRoot.get(root)
    const permitted = new Set(layerZ)
    const allowed =
      previous === undefined
        ? [...permitted]
        : previous.filter((z) => permitted.has(z))
    if (allowed.length === 0) {
      throw new Error(`Connection "${name}" has no permitted wire layers`)
    }
    allowedZByRoot.set(
      root,
      allowed.sort((a, b) => a - b),
    )
  }
  const result = new Map<string, number[]>()
  for (const name of names) {
    const allowed = allowedZByRoot.get(aliases.find(name))
    if (allowed !== undefined) result.set(name, allowed)
  }
  for (const connection of srj.connections) {
    const allowed = result.get(connection.name)
    if (allowed === undefined) continue
    for (const point of connection.pointsToConnect) {
      const layers = getConnectionPointLayers(point)
      if (
        !layers.some((layer) =>
          allowed.includes(mapLayerNameToZ(layer, srj.layerCount)),
        )
      ) {
        throw new Error(
          `Connection "${connection.name}" has a terminal outside its allowed wire layers`,
        )
      }
    }
  }
  return result
}
