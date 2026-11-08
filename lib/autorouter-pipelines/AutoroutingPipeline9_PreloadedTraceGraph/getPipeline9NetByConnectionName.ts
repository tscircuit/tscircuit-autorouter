import { getHdRouteNetId } from "lib/utils/getHdRouteNetId"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"

export const getPipeline9NetByConnectionName = (
  routes: ReadonlyArray<HighDensityRoute>,
  connMap: ConnectivityMap,
): ReadonlyMap<string, string> =>
  new Map(
    routes.flatMap((route) => {
      const netName = getHdRouteNetId(route, connMap)
      return netName ? [[route.connectionName, netName] as const] : []
    }),
  )
