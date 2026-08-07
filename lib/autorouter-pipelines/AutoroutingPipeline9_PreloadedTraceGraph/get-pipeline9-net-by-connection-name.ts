import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"

export const getPipeline9NetByConnectionName = (
  routes: ReadonlyArray<HighDensityRoute>,
  connMap: ConnectivityMap,
): ReadonlyMap<string, string> =>
  new Map(
    routes.flatMap((route) => {
      const netName =
        connMap.getNetConnectedToId(route.connectionName) ??
        (route.rootConnectionName
          ? (connMap.getNetConnectedToId(route.rootConnectionName) ??
            (connMap.netMap[route.rootConnectionName]
              ? route.rootConnectionName
              : undefined))
          : undefined)
      return netName ? [[route.connectionName, netName] as const] : []
    }),
  )
