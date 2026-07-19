import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

export interface ConvertPipeline7HdRoutesOptions {
  connections: SimpleRouteConnection[]
  originalConnections: SimpleRouteConnection[]
  hdRoutes: HighDensityRoute[]
  layerCount: number
  obstacles: Obstacle[]
  defaultViaHoleDiameter: number
  connMap: ConnectivityMap
  routeConversionCache?: WeakMap<HighDensityRoute, SimplifiedPcbTrace["route"]>
}
/** Converts Pipeline7 routes using the same net and terminal rules as final output. */
export const convertPipeline7HdRoutesToSimplifiedPcbTraces = ({
  connections,
  originalConnections,
  hdRoutes,
  layerCount,
  obstacles,
  defaultViaHoleDiameter,
  connMap,
  routeConversionCache,
}: ConvertPipeline7HdRoutesOptions): SimplifiedPcbTraces => {
  const traces: SimplifiedPcbTraces = []
  const originalConnectionByName = new Map(
    originalConnections.map((connection) => [connection.name, connection]),
  )
  const routesByConnectionName = new Map<string, HighDensityRoute[]>()
  for (const route of hdRoutes) {
    const connectionRoutes = routesByConnectionName.get(route.connectionName)
    if (connectionRoutes) connectionRoutes.push(route)
    else routesByConnectionName.set(route.connectionName, [route])
  }

  for (const connection of connections) {
    const netConnectionName =
      connection.__netConnectionName ??
      originalConnectionByName.get(connection.name)?.__netConnectionName
    const connectionRoutes = routesByConnectionName.get(connection.name) ?? []

    if (connection.pointsToConnect.length !== 2) {
      throw new Error(
        `Expected Pipeline7 output connection "${connection.name}" to have two points, got ${connection.pointsToConnect.length}`,
      )
    }

    const [startPoint, endPoint] = connection.pointsToConnect
    const connectsTo = [startPoint?.pointId, endPoint?.pointId].filter(
      (pointId): pointId is string => Boolean(pointId),
    )

    for (let index = 0; index < connectionRoutes.length; index += 1) {
      const hdRoute = connectionRoutes[index]!
      let simplifiedRoute = routeConversionCache?.get(hdRoute)
      if (!simplifiedRoute) {
        simplifiedRoute = convertHdRouteToSimplifiedRoute(hdRoute, layerCount, {
          connectionPoints: connection.pointsToConnect,
          defaultViaHoleDiameter,
          obstacles,
          connMap,
        })
        routeConversionCache?.set(hdRoute, simplifiedRoute)
      }
      const simplifiedPcbTrace: SimplifiedPcbTrace = {
        type: "pcb_trace",
        pcb_trace_id: `${connection.name}_${index}`,
        connection_name:
          netConnectionName ??
          connection.__rootConnectionNames?.[0] ??
          connection.name,
        connectsTo,
        route: simplifiedRoute,
      }

      traces.push(simplifiedPcbTrace)
    }
  }

  return traces
}
