import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

/** Carry declared net aliases into repair without confusing net IDs with alias IDs. */
export const preparePipeline9RepairConnectivity = ({
  srj,
  routes,
  connMap,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  connMap: ConnectivityMap
}): { srj: SimpleRouteJson; routes: HighDensityRoute[] } => {
  const representativeByNet = new Map<string, string>()
  const aliasConnections = Object.entries(connMap.netMap).map(([net, ids]) => {
    const representative = ids[0]
    if (!representative) throw new Error(`Repair net "${net}" has no aliases`)
    representativeByNet.set(net, representative)
    return {
      name: representative,
      mergedConnectionNames: ids,
      pointsToConnect: [],
    }
  })
  return {
    srj: { ...srj, connections: [...srj.connections, ...aliasConnections] },
    routes: routes.map((route): HighDensityRoute => {
      // Preloaded route roots are internal ConnectivityMap net IDs. Those IDs
      // can also be aliases for a different net in the original SRJ, so never
      // expose them as unqualified names to repair's union-find resolver.
      const net =
        connMap.getNetConnectedToId(route.connectionName) ??
        (route.rootConnectionName &&
          (connMap.netMap[route.rootConnectionName]
            ? route.rootConnectionName
            : connMap.getNetConnectedToId(route.rootConnectionName)))
      if (!net) {
        throw new Error(
          `Repair route "${route.connectionName}" has no declared net`,
        )
      }
      return { ...route, rootConnectionName: representativeByNet.get(net)! }
    }),
  }
}
