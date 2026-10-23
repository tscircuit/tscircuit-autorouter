import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Every branch still joins the same pad/junction graph after geometric repair. */
export function assertSharedElectricalTreeRoutes(input: {
  connections: SimpleRouteConnection[]
  routes: HighDensityRoute[]
  layerCount: number
}): void {
  const byName = new Map<string, HighDensityRoute>()
  for (const route of input.routes) {
    if (byName.has(route.connectionName)) throw new Error(`Electrical tree has duplicate output branch ${route.connectionName}`)
    byName.set(route.connectionName, route)
  }
  const positions = new Map<string, { x: number; y: number; z: number }>()
  for (const connection of input.connections) {
    const branch = connection.electricalBranch
    if (!branch) throw new Error(`Electrical tree output lacks physical branch contract for ${connection.name}`)
    const route = byName.get(connection.name)
    if (!route) throw new Error(`Electrical tree lost output branch ${connection.name}`)
    byName.delete(connection.name)
    const endpoints = [route.route[0], route.route.at(-1)]
    for (const index of [0, 1] as const) {
      const point = endpoints[index]
      const expected = connection.pointsToConnect[index]
      const vertexId = index === 0 ? branch.startVertexId : branch.endVertexId
      if (!point || !expected || ![point.x, point.y, point.z].every(Number.isFinite) ||
        point.z !== mapLayerNameToZ(getConnectionPointLayer(expected), input.layerCount)) {
        throw new Error(`Electrical tree lost endpoint layer of ${connection.name}`)
      }
      if (expected.pcb_port_id && (Math.hypot(point.x - expected.x, point.y - expected.y) > 1e-6 ||
        point.pcb_port_id !== expected.pcb_port_id)) {
        throw new Error(`Electrical tree moved physical pad ${expected.pcb_port_id}`)
      }
      const previous = positions.get(vertexId)
      if (previous && (Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-6 || previous.z !== point.z)) {
        throw new Error(`Electrical tree disconnected shared junction ${vertexId}`)
      }
      positions.set(vertexId, point)
    }
  }
  if (byName.size > 0) throw new Error(`Electrical tree has unowned output branches: ${[...byName.keys()].join(", ")}`)
}
