import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"

export function getBusRoutingLayers(srj: SimpleRouteJson) {
  const byMember = new Map<string, ReadonlySet<number>>()
  for (const bus of srj.buses ?? []) {
    if (!bus.allowedLayers?.length) continue
    const layers = getUniqueValidZLayersFromLayerNames(
      bus.allowedLayers,
      srj.layerCount,
    )
    for (const name of bus.connectionNames) {
      const previous = byMember.get(name)
      byMember.set(
        name,
        new Set(previous ? layers.filter((z) => previous.has(z)) : layers),
      )
    }
  }

  const byConnection = new Map<string, ReadonlySet<number>>()
  if (byMember.size === 0) return byConnection
  for (const connection of srj.connections) {
    for (const name of [
      connection.name,
      ...(connection.__rootConnectionNames ?? []),
    ]) {
      const layers = byMember.get(name)
      if (!layers) continue
      const previous = byConnection.get(connection.name)
      byConnection.set(
        connection.name,
        previous ? new Set([...layers].filter((z) => previous.has(z))) : layers,
      )
    }
  }
  return byConnection
}

export function obeysBusRoutingLayers(
  { route }: HighDensityRoute,
  allowedLayers: ReadonlySet<number>,
) {
  const copperLayers: number[] = []
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1]!
    const to = route[index]!
    if (from.z !== to.z || (from.x === to.x && from.y === to.y)) continue
    if (copperLayers.at(-1) !== from.z) copperLayers.push(from.z)
  }
  return (
    copperLayers.some((z) => allowedLayers.has(z)) &&
    copperLayers.every(
      (z, index) =>
        allowedLayers.has(z) ||
        (index === 0 && z === route[0]?.z) ||
        (index === copperLayers.length - 1 && z === route.at(-1)?.z),
    )
  )
}
