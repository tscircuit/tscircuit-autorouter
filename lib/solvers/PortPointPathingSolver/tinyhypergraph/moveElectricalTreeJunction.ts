import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

/** Translate one free physical vertex and all incident branch/via copies. */
export function moveElectricalTreeJunction(input: {
  connections: SimpleRouteConnection[]
  routes: HighDensityRoute[]
  vertexId: string
  dx: number
  dy: number
}): HighDensityRoute[] | undefined {
  if (![input.dx, input.dy].every(Number.isFinite)) throw new Error("Electrical junction movement must be finite")
  const byName = new Map(input.routes.map((route) => [route.connectionName, route]))
  const vertices = new Set([input.vertexId])
  // A vertical physical edge has one XY variable on both layers. Include the
  // other layer's incident branches before moving any occurrence of that via.
  let changed = true
  while (changed) {
    changed = false
    for (const connection of input.connections) {
      const branch = connection.electricalBranch
      if (!branch || (!vertices.has(branch.startVertexId) && !vertices.has(branch.endVertexId))) continue
      const route = byName.get(connection.name)
      if (!route) throw new Error(`Electrical junction movement lost branch ${connection.name}`)
      const start = route.route[0]!, end = route.route.at(-1)!
      if (start.z === end.z || start.x !== end.x || start.y !== end.y) continue
      for (const vertex of [branch.startVertexId, branch.endVertexId]) {
        if (!vertices.has(vertex)) {
          vertices.add(vertex)
          changed = true
        }
      }
    }
  }
  const incident = new Map<string, Array<0 | 1>>()
  const vertexAtEndpoint = new Map<string, string>()
  for (const connection of input.connections) {
    const branch = connection.electricalBranch
    if (!branch) continue
    for (const index of [0, 1] as const) {
      const id = index === 0 ? branch.startVertexId : branch.endVertexId
      if (!vertices.has(id)) continue
      if (connection.pointsToConnect[index]!.pcb_port_id) return undefined
      const endpoints = incident.get(connection.name) ?? []
      endpoints.push(index)
      incident.set(connection.name, endpoints)
      vertexAtEndpoint.set(`${connection.name}:${index}`, id)
    }
  }
  if (incident.size < 2) return undefined
  let origin: HighDensityRoute["route"][number] | undefined
  const layerByVertex = new Map<string, number>()
  for (const route of input.routes) {
    for (const endpoint of incident.get(route.connectionName) ?? []) {
      const point = endpoint === 0 ? route.route[0] : route.route.at(-1)
      if (!point) throw new Error("Electrical junction movement lost an incident endpoint")
      const vertex = vertexAtEndpoint.get(`${route.connectionName}:${endpoint}`)!
      const layer = layerByVertex.get(vertex)
      if ((origin && (origin.x !== point.x || origin.y !== point.y)) || (layer !== undefined && layer !== point.z)) throw new Error("Electrical junction movement received disconnected ownership")
      layerByVertex.set(vertex, point.z)
      origin = point
    }
  }
  if (!origin) throw new Error("Electrical junction movement has no owned geometry")
  const anchor = origin
  for (const route of input.routes) {
    if (!incident.has(route.connectionName)) continue
    for (let index = 0; index < route.route.length; index++) {
      const point = route.route[index]!
      if (point.x !== anchor.x || point.y !== anchor.y) continue
      // A fixed pad or through-obstacle segment is not a free junction.
      if (point.pcb_port_id || point.insideJumperPad || point.toNextSegmentType || route.route[index - 1]?.toNextSegmentType) return undefined
    }
  }
  return input.routes.map((route) => !incident.has(route.connectionName) ? route : ({
    ...route,
    route: route.route.map((point) => point.x === anchor.x && point.y === anchor.y
      ? { ...point, x: point.x + input.dx, y: point.y + input.dy } : point),
    vias: route.vias.map((via) => via.x === anchor.x && via.y === anchor.y
      ? { x: via.x + input.dx, y: via.y + input.dy } : via),
  }))
}
