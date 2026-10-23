import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getElectricalTreeTerminalWitness } from "./getElectricalTreeTerminalWitness"

type Position = { x: number; y: number }
type Reference = { routeIndex: number; pointIndex: number; padId?: string; originalTerminal: boolean; expected: Position; z: number }
type Vertex = { netId: string; refs: Reference[] }

/** Convert native roundoff copies back to one exact shared coordinate variable. */
export function normalizeSharedElectricalTreeRouteEndpoints(input: {
  connections: readonly SimpleRouteConnection[]
  routes: HighDensityRoute[]
  layerCount: number
  connMap: ConnectivityMap
  /** Cleanup preserves the already published junction positions as well. */
  preserveJunctionPositions?: boolean
}): { routes: HighDensityRoute[]; endpointChecks: number; normalizedEndpoints: number; normalizedViaPoints: number; normalizedViaRecords: number; maxDisplacement: number } {
  if (!Number.isInteger(input.layerCount) || input.layerCount < 1) throw new Error("Shared endpoint normalization requires a valid layer count")
  const vertices = new Map<string, Vertex>()
  const branchNames = new Set<string>()
  const byName = new Map<string, number>()
  input.routes.forEach((route, index): void => {
    if (byName.has(route.connectionName)) throw new Error(`Shared endpoint normalization has duplicate route ${route.connectionName}`)
    byName.set(route.connectionName, index)
  })
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) {
      const next = parent.get(root)
      if (next === undefined) throw new Error(`Shared endpoint normalization lost vertex ${root}`)
      root = next
    }
    return root
  }
  const vertical: Array<[string, string]> = []
  for (const connection of input.connections) {
    const branch = connection.electricalBranch
    if (!branch) continue
    if (typeof branch.netId !== "string" || !branch.netId) throw new Error(`Shared endpoint normalization has no root for ${connection.name}`)
    if (branchNames.has(connection.name)) throw new Error(`Shared endpoint normalization has duplicate branch ${connection.name}`)
    branchNames.add(connection.name)
    const routeIndex = byName.get(connection.name)
    if (routeIndex === undefined) throw new Error(`Shared endpoint normalization lost branch ${connection.name}`)
    const route = input.routes[routeIndex]!
    const expectedRoot = input.connMap.getNetConnectedToId(connection.name)
    const routeRoot = route.rootConnectionName ?? route.connectionName
    // Native net keys are also legal serialized aliases. A key can therefore
    // occur in idToNetMap for another net; exact canonical equality wins before
    // interpreting the same string as an ordinary alias.
    const routeCanonicalRoot = routeRoot === expectedRoot ? expectedRoot : input.connMap.getNetConnectedToId(routeRoot)
    const witnessRoot = branch.netId === expectedRoot ? expectedRoot : input.connMap.getNetConnectedToId(branch.netId)
    if (!expectedRoot || routeCanonicalRoot !== expectedRoot || witnessRoot !== expectedRoot) throw new Error(`Shared endpoint normalization has an uncertified route root on ${connection.name}: expected ${expectedRoot}, route ${routeRoot} -> ${routeCanonicalRoot}, witness ${branch.netId} -> ${witnessRoot}`)
    if (route.route.length < 2) throw new Error(`Shared endpoint normalization has empty branch ${connection.name}`)
    for (const endpoint of [0, 1] as const) {
      const id = endpoint === 0 ? branch.startVertexId : branch.endVertexId
      const expected = connection.pointsToConnect[endpoint]
      const pointIndex = endpoint === 0 ? 0 : route.route.length - 1
      const point = route.route[pointIndex]!
      if (!id || !expected || expected.pcb_port_id === "" || ![expected.x, expected.y, point.x, point.y, point.z].every(Number.isFinite)) {
        throw new Error(`Shared endpoint normalization has invalid witness for ${connection.name}`)
      }
      const z = mapLayerNameToZ(getConnectionPointLayer(expected), input.layerCount)
      if (!Number.isInteger(z) || z < 0 || z >= input.layerCount || point.z !== z) throw new Error(`Shared endpoint normalization changed layer of ${connection.name}`)
      if (point.pcb_port_id !== undefined && point.pcb_port_id !== expected.pcb_port_id) throw new Error(`Shared endpoint normalization has conflicting PCB identity on ${connection.name}`)
      const routeTag = endpoint === 0 ? route.startPcbPortId : route.endPcbPortId
      if (routeTag !== undefined && routeTag !== expected.pcb_port_id) throw new Error(`Shared endpoint normalization has conflicting route terminal on ${connection.name}`)
      const vertex = vertices.get(id) ?? { netId: branch.netId, refs: [] }
      if (vertex.netId !== branch.netId) throw new Error(`Shared endpoint normalization joins different roots at ${id}`)
      if (vertex.refs[0] && vertex.refs[0].z !== z) throw new Error(`Shared endpoint normalization has conflicting vertex layers at ${id}`)
      vertex.refs.push({ routeIndex, pointIndex, padId: expected.pcb_port_id, originalTerminal: getElectricalTreeTerminalWitness(connection, endpoint, input.layerCount) !== undefined, expected, z })
      vertices.set(id, vertex)
      parent.set(id, id)
    }
    const first = route.route[0]!, last = route.route.at(-1)!
    if (first.z !== last.z && route.route.every((point) => point.x === first.x && point.y === first.y) &&
      !route.route.some((point) => point.toNextSegmentType)) vertical.push([branch.startVertexId, branch.endVertexId])
  }
  for (const [a, b] of vertical) {
    if (vertices.get(a)!.netId !== vertices.get(b)!.netId) throw new Error("Shared endpoint normalization has a mixed-root via")
    parent.set(find(a), find(b))
  }
  const targets = new Map<string, Position>()
  for (const [id, vertex] of vertices) {
    for (const ref of vertex.refs) {
      if (!ref.padId && !ref.originalTerminal && !input.preserveJunctionPositions) continue
      const root = find(id), previous = targets.get(root)
      if (previous && (previous.x !== ref.expected.x || previous.y !== ref.expected.y)) throw new Error(`Shared endpoint normalization has conflicting fixed positions at ${id}`)
      targets.set(root, ref.expected)
    }
  }
  for (const [id, vertex] of vertices) {
    const root = find(id), ref = vertex.refs[0]!
    if (!targets.has(root)) targets.set(root, input.routes[ref.routeIndex]!.route[ref.pointIndex]!)
  }
  const routes = [...input.routes]
  const owned = new Set<number>()
  const stats = { endpointChecks: 0, normalizedEndpoints: 0, normalizedViaPoints: 0, normalizedViaRecords: 0, maxDisplacement: 0 }
  const viaMoves = new Map<number, Map<string, Position>>()
  for (const [id, vertex] of vertices) {
    const target = targets.get(find(id))!
    for (const ref of vertex.refs) {
      stats.endpointChecks++
      const sourceRoute = input.routes[ref.routeIndex]!, point = sourceRoute.route[ref.pointIndex]!
      const displacement = Math.hypot(point.x - target.x, point.y - target.y)
      const scale = Math.max(1, Math.abs(point.x), Math.abs(point.y), Math.abs(target.x), Math.abs(target.y))
      const limit = Math.min(1e-9, 64 * Number.EPSILON * scale, sourceRoute.traceThickness * 1e-9)
      if (!Number.isFinite(limit) || limit <= 0 || displacement > limit) throw new Error(`Shared endpoint normalization exceeds roundoff at ${id}`)
      if ((ref.padId || ref.originalTerminal) && (target.x !== ref.expected.x || target.y !== ref.expected.y)) throw new Error(`Shared endpoint normalization moved immutable terminal on ${sourceRoute.connectionName}`)
      const routeTag = ref.pointIndex === 0 ? sourceRoute.startPcbPortId : sourceRoute.endPcbPortId
      if (displacement === 0 && point.pcb_port_id === ref.padId && routeTag === ref.padId) continue
      if (!owned.has(ref.routeIndex)) {
        routes[ref.routeIndex] = { ...sourceRoute, route: sourceRoute.route.map((value) => ({ ...value })), vias: sourceRoute.vias.map((via) => ({ ...via })) }
        owned.add(ref.routeIndex)
      }
      const route = routes[ref.routeIndex]!
      route.route[ref.pointIndex] = { ...route.route[ref.pointIndex]!, x: target.x, y: target.y, ...(ref.padId ? { pcb_port_id: ref.padId } : {}) }
      if (ref.padId && ref.pointIndex === 0) route.startPcbPortId = ref.padId
      if (ref.padId && ref.pointIndex === route.route.length - 1) route.endPcbPortId = ref.padId
      if (displacement === 0) continue
      stats.normalizedEndpoints++
      stats.maxDisplacement = Math.max(stats.maxDisplacement, displacement)
      const direction = ref.pointIndex === 0 ? 1 : -1
      for (let index = ref.pointIndex + direction; index >= 0 && index < route.route.length; index += direction) {
        const original = sourceRoute.route[index]!
        if (original.x !== point.x || original.y !== point.y) break
        if (original.pcb_port_id && original.pcb_port_id !== ref.padId) throw new Error(`Shared endpoint normalization crosses another fixed pad on ${route.connectionName}`)
        route.route[index] = { ...route.route[index]!, x: target.x, y: target.y }
        stats.normalizedViaPoints++
      }
      const moves = viaMoves.get(ref.routeIndex) ?? new Map<string, Position>()
      const key = JSON.stringify([point.x, point.y]), previous = moves.get(key)
      if (previous && (previous.x !== target.x || previous.y !== target.y)) throw new Error(`Shared endpoint normalization has conflicting drill ownership on ${route.connectionName}`)
      moves.set(key, target)
      viaMoves.set(ref.routeIndex, moves)
    }
  }
  for (const [index, moves] of viaMoves) {
    const route = routes[index]!
    route.vias = input.routes[index]!.vias.map((via) => {
      const target = moves.get(JSON.stringify([via.x, via.y]))
      if (!target) return via
      stats.normalizedViaRecords++
      return { ...via, x: target.x, y: target.y }
    })
    for (let point = 1; point < route.route.length; point++) {
      const a = route.route[point - 1]!, b = route.route[point]!
      if (a.z !== b.z && a.toNextSegmentType !== "through_obstacle" && (a.x !== b.x || a.y !== b.y)) throw new Error(`Shared endpoint normalization left a diagonal via on ${route.connectionName}`)
    }
  }
  return { routes, ...stats }
}
