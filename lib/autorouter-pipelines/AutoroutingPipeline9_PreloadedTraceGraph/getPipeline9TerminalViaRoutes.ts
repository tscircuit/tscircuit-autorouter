import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Reserve the physical terminal drills that SRJ conversion adds to planar routes. */
export function getPipeline9TerminalViaRoutes({
  srj,
  routes,
  connMap,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  connMap?: ConnectivityMap
}): HighDensityRoute[] {
  const connections = new Map(
    srj.connections.map((connection) => [connection.name, connection]),
  )
  const result: HighDensityRoute[] = []
  const seen = new Set<string>()
  for (const route of routes) {
    const connection = connections.get(route.connectionName)
    const terminals = connection?.pointsToConnect.filter(
      (point) => "terminalVia" in point && point.terminalVia,
    )
    if (!terminals?.length) continue
    const physicalRoute = convertHdRouteToSimplifiedRoute(
      route,
      srj.layerCount,
      {
        connectionPoints: connection!.pointsToConnect,
        obstacles: srj.obstacles,
        connMap,
      },
    )
    for (const point of physicalRoute) {
      if (
        point.route_type !== "via" ||
        !terminals.some(
          (terminal) => terminal.x === point.x && terminal.y === point.y,
        )
      )
        continue
      const key = `${route.rootConnectionName ?? route.connectionName}:${point.x}:${point.y}:${point.from_layer}:${point.to_layer}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        connectionName: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        traceThickness: route.traceThickness,
        viaDiameter: point.via_diameter ?? route.viaDiameter,
        route: [
          {
            x: point.x,
            y: point.y,
            z: mapLayerNameToZ(point.from_layer, srj.layerCount),
          },
          {
            x: point.x,
            y: point.y,
            z: mapLayerNameToZ(point.to_layer, srj.layerCount),
          },
        ],
        vias: [{ x: point.x, y: point.y }],
      })
    }
  }
  return result
}
