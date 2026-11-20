import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"

type ConnectionName = SimpleRouteConnection["name"]
export type BusRoutingLayers = ReadonlyMap<ConnectionName, ReadonlySet<number>>

function intersectBusLayers(
  previousLayers: ReadonlySet<number> | undefined,
  layers: ReadonlySet<number>,
): ReadonlySet<number> {
  if (!previousLayers || previousLayers === layers) return layers
  return new Set([...previousLayers].filter((z) => layers.has(z)))
}

export function getBusRoutingLayers(srj: SimpleRouteJson): BusRoutingLayers {
  const byMember = new Map<ConnectionName, ReadonlySet<number>>()
  for (const bus of srj.buses ?? []) {
    if (!bus.allowedLayers?.length) continue
    const layers = new Set(
      getUniqueValidZLayersFromLayerNames(bus.allowedLayers, srj.layerCount),
    )
    for (const name of bus.connectionNames) {
      byMember.set(name, intersectBusLayers(byMember.get(name), layers))
    }
  }

  if (byMember.size === 0) return byMember
  const byConnection = new Map<ConnectionName, ReadonlySet<number>>()
  for (const connection of srj.connections) {
    let layers = byMember.get(connection.name)
    for (const name of connection.__rootConnectionNames ?? []) {
      const memberLayers = byMember.get(name)
      if (memberLayers) layers = intersectBusLayers(layers, memberLayers)
    }
    if (layers) byConnection.set(connection.name, layers)
  }
  return byConnection
}

function obeysBusRoutingLayers(
  { connectionName, route }: HighDensityRoute,
  busRoutingLayers: BusRoutingLayers,
): boolean {
  const allowedLayers = busRoutingLayers.get(connectionName)
  if (!allowedLayers) return true

  const startLayer = route[0]?.z
  const endLayer = route.at(-1)?.z
  let foundAllowedCopper = false
  let reachedEndEscape = false
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1]!
    const to = route[index]!
    if (from.z !== to.z || (from.x === to.x && from.y === to.y)) continue
    if (allowedLayers.has(from.z)) {
      if (reachedEndEscape) return false
      foundAllowedCopper = true
    } else if (foundAllowedCopper) {
      if (from.z !== endLayer) return false
      reachedEndEscape = true
    } else if (from.z !== startLayer) {
      return false
    }
  }
  return foundAllowedCopper
}

export function findRouteOutsideBusLayers(
  routes: HighDensityRoute[],
  busRoutingLayers: BusRoutingLayers,
): HighDensityRoute | undefined {
  if (busRoutingLayers.size === 0) return
  return routes.find((route) => !obeysBusRoutingLayers(route, busRoutingLayers))
}
