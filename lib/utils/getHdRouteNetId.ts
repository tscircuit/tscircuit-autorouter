import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"

/** Connection names are aliases; retained route roots can be canonical net IDs. */
export const getHdRouteNetId = (
  route: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">,
  connMap: ConnectivityMap,
): string | undefined =>
  connMap.getNetConnectedToId(route.connectionName) ??
  (route.rootConnectionName
    ? connMap.netMap[route.rootConnectionName]
      ? route.rootConnectionName
      : connMap.getNetConnectedToId(route.rootConnectionName)
    : undefined)
