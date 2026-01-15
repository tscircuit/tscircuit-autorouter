import { SimpleRouteConnection } from "lib/types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { MultipleHighDensityRouteStitchSolver } from "./MultipleHighDensityRouteStitchSolver"

/**
 * A simplified version of MultipleHighDensityRouteStitchSolver that doesn't handle
 * off-board routing cases. It always uses the connection's pointsToConnect directly
 * instead of analyzing possible endpoints from route islands.
 */
export class NoOffBoardMultipleHighDensityRouteStitchSolver extends MultipleHighDensityRouteStitchSolver {
  constructor(params: {
    connections: SimpleRouteConnection[]
    hdRoutes: any[]
    colorMap?: Record<string, string>
    layerCount: number
    defaultViaDiameter?: number
  }) {
    super(params)

    // Override the unsolvedRoutes to use connection points directly
    // instead of analyzing possible endpoints
    this.unsolvedRoutes = []

    const routesByConnection = new Map<string, any[]>()
    for (const hdRoute of params.hdRoutes) {
      const routes = routesByConnection.get(hdRoute.connectionName) || []
      routes.push(hdRoute)
      routesByConnection.set(hdRoute.connectionName, routes)
    }

    // Process connections with hdRoutes
    for (const [connectionName, hdRoutes] of routesByConnection.entries()) {
      const connection = params.connections.find(
        (c) => c.name === connectionName,
      )
      if (!connection) continue

      const start = {
        ...connection.pointsToConnect[0],
        z: mapLayerNameToZ(
          getConnectionPointLayer(connection.pointsToConnect[0]),
          params.layerCount,
        ),
      }
      const end = {
        ...connection.pointsToConnect[1],
        z: mapLayerNameToZ(
          getConnectionPointLayer(connection.pointsToConnect[1]),
          params.layerCount,
        ),
      }

      this.unsolvedRoutes.push({
        connectionName,
        hdRoutes,
        start,
        end,
      })
    }

    // Add connections that don't have any hdRoutes
    for (const connection of params.connections) {
      if (!routesByConnection.has(connection.name)) {
        this.unsolvedRoutes.push({
          connectionName: connection.name,
          hdRoutes: [],
          start: {
            ...connection.pointsToConnect[0],
            z: mapLayerNameToZ(
              getConnectionPointLayer(connection.pointsToConnect[0]),
              params.layerCount,
            ),
          },
          end: {
            ...connection.pointsToConnect[1],
            z: mapLayerNameToZ(
              getConnectionPointLayer(connection.pointsToConnect[1]),
              params.layerCount,
            ),
          },
        })
      }
    }
  }
}
