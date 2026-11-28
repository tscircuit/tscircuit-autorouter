import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

type Route = HighDensityIntraNodeRoute

/** Connect routed fragments that meet the same existing plated barrel. */
export function getPreloadedViaBridges({
  hdRoutes,
  otherHdRoutes,
  connMap,
  layerCount,
  allowBlindAndBuriedVias,
}: {
  hdRoutes: Route[]
  otherHdRoutes: Route[]
  connMap: ConnectivityMap
  layerCount: number
  allowBlindAndBuriedVias?: boolean
}): Route[] {
  if (otherHdRoutes.length === 0) return []
  const netForRoute = (route: Route): string => {
    const net = connMap.getNetConnectedToId(route.connectionName)
    if (net !== undefined) return net
    if (route.rootConnectionName !== undefined) {
      return connMap.getNetConnectedToId(route.rootConnectionName) ??
        route.rootConnectionName
    }
    return route.connectionName
  }
  const endpointsByNet = new Map<string, Array<{ route: Route; point: Route["route"][number] }>>()
  for (const route of hdRoutes) {
    if (route.route.length < 2) continue
    const net = netForRoute(route)
    const endpoints = endpointsByNet.get(net) ?? []
    endpoints.push({ route, point: route.route[0]! }, { route, point: route.route.at(-1)! })
    endpointsByNet.set(net, endpoints)
  }
  const bridges: Route[] = []
  const seen = new Set<string>()
  for (const fixed of otherHdRoutes) {
    const endpoints = endpointsByNet.get(netForRoute(fixed))
    if (!endpoints) continue
    for (const via of getPipeline9RouteCopperGeometry(fixed, { layerCount, allowBlindAndBuriedVias }).viaSpans) {
      const routesByConnection = new Map<string, Route>()
      for (const { route, point } of endpoints) {
        if (point.z < via.minZ || point.z > via.maxZ ||
          Math.hypot(point.x - via.center.x, point.y - via.center.y) > 1e-6) continue
        routesByConnection.set(route.connectionName, route)
      }
      for (const route of routesByConnection.values()) {
        for (let fromZ = via.minZ; fromZ < via.maxZ; fromZ++) {
          const toZ = fromZ + 1
          const key = `${route.connectionName}:${via.center.x}:${via.center.y}:${fromZ}:${toZ}`
          if (seen.has(key)) continue
          seen.add(key)
          bridges.push({
            connectionName: route.connectionName,
            rootConnectionName: route.rootConnectionName,
            traceThickness: route.traceThickness,
            viaDiameter: via.diameter,
            route: [
              { ...via.center, z: fromZ, toNextSegmentType: "through_obstacle" },
              { ...via.center, z: toZ },
            ],
            vias: [],
          })
        }
      }
    }
  }
  return bridges
}
