import type { Point3 } from "@tscircuit/math-utils"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { selectDeclaredTerminalPath } from "./selectDeclaredTerminalPath"

type TerminalPoint = Point3 & { pcb_port_id?: string }

/**
 * A terminal-locked route is a declared demand, not a geometric island. Keep
 * its immutable endpoints and owned fragments together: snapping each island
 * independently can select the same PCB pad twice, and borrowing another
 * demand's fragments changes the meaning of their endpoint tags.
 */
export function getDeclaredTerminalStitchRoutes(input: {
  connections: SimpleRouteConnection[]
  hdRoutes: HighDensityIntraNodeRoute[]
  layerCount: number
  /** Caller has independently proved these demands on retained physical copper. */
  preconnectedConnectionNames?: ReadonlySet<string>
}): Array<{
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  start: TerminalPoint
  end: TerminalPoint
}> {
  const connectionByName = new Map(input.connections.map((connection) => [connection.name, connection]))
  if (connectionByName.size !== input.connections.length) {
    throw new Error("Declared terminal stitching received duplicate connection names")
  }
  const routesByConnection = new Map<string, HighDensityIntraNodeRoute[]>()
  for (const route of input.hdRoutes) {
    if (!connectionByName.has(route.connectionName)) {
      throw new Error(`Declared terminal stitching has unknown route owner ${route.connectionName}`)
    }
    const routes = routesByConnection.get(route.connectionName) ?? []
    routes.push(route)
    routesByConnection.set(route.connectionName, routes)
  }
  for (const connection of input.connections) {
    if (!routesByConnection.has(connection.name) &&
      !input.preconnectedConnectionNames?.has(connection.name)) {
      throw new Error(`Declared terminal stitching has no copper for ${connection.name}`)
    }
  }
  for (const name of input.preconnectedConnectionNames ?? []) {
    if (!connectionByName.has(name)) throw new Error(`Declared terminal stitching has unknown connectivity witness ${name}`)
  }
  return [...routesByConnection].map(([connectionName, hdRoutes]) => {
    const connection = connectionByName.get(connectionName)!
    if (connection.pointsToConnect.length !== 2) {
      throw new Error(`Declared terminal stitching requires two endpoints for ${connectionName}`)
    }
    const endpoints = connection.pointsToConnect.map((point): TerminalPoint => {
      const z = mapLayerNameToZ(getConnectionPointLayer(point), input.layerCount)
      if (![point.x, point.y, z].every(Number.isFinite)) {
        throw new Error(`Declared terminal stitching has invalid endpoint for ${connectionName}`)
      }
      return { ...point, z }
    })
    if (endpoints[0]!.pcb_port_id && endpoints[0]!.pcb_port_id === endpoints[1]!.pcb_port_id) {
      throw new Error(`Declared terminal stitching has duplicate PCB terminal for ${connectionName}`)
    }
    const expected = new Set(connection.pointsToConnect.flatMap((point) => point.pcb_port_id ? [point.pcb_port_id] : []))
    for (const route of hdRoutes) {
      for (const tag of [route.startPcbPortId, route.endPcbPortId]) {
        if (tag !== undefined && !expected.has(tag)) throw new Error(`Declared terminal stitching found unknown PCB terminal ${tag} for ${connectionName}`)
      }
    }
    return { connectionName, hdRoutes: selectDeclaredTerminalPath({ connectionName, routes: hdRoutes,
      start: endpoints[0]!, end: endpoints[1]! }), start: endpoints[0]!, end: endpoints[1]! }
  })
}
