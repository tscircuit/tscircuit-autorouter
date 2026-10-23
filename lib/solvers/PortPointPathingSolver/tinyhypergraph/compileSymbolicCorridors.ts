import { PriorityQueue } from "lib/data-structures/PriorityQueue"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { SimpleRouteConnection } from "lib/types/srj-types"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { hasPreloadedTraceSectionMetadata } from "./serializePreloadedTraceAssignments"
import { realizeSymbolicLaneOrders } from "./realizeSymbolicLaneOrders"

type Region = SerializedHyperGraph["regions"][number]
type SerializedPort = SerializedHyperGraph["ports"][number]
type Corridor = { id: string; a: string; b: string; z: number; ports: SerializedPort[]; users: number[]; cost: number; locked: boolean }
type RoutePlan = { id: string; name: string; root: string; z: number; regions: string[]; corridors: Corridor[]; start: SerializedPort; end: SerializedPort }
export type SymbolicCorridorResult = { applicable: boolean; nodes: NodeWithPortPoints[]; stats: Record<string, number> }
const EPS = 1e-7

/**
 * Search one capacity edge per region-interface/layer, never one geometric slot
 * per candidate. Identities obtain concrete slots only after all corridor paths
 * exist and the coupled symbolic ordering constraints have been realized.
 * This is a certified compiler for one greedy corridor allocation; it makes no
 * completeness claim when allocation, capacities, or parity domains reject it.
 */
export function compileSymbolicCorridors(graph: SerializedHyperGraph, hasCoupledConstraints = false): SymbolicCorridorResult {
  const stats: Record<string, number> = { symbolicCorridorAttempts: 1, symbolicCorridorAcceptedProblems: 0, symbolicCorridorUnsupportedCoupledConstraints: 0, symbolicCorridorUnsupportedPreloads: 0, symbolicCorridorUnsupportedAssignments: 0, symbolicCorridorUnsupportedLayers: 0, symbolicCorridorCapacityRejectedProblems: 0, symbolicCorridorOrderRejectedProblems: 0, symbolicCorridorOriginalPorts: graph.ports.length, symbolicCorridorCapacityEdges: 0, symbolicCorridorGraphRelaxations: 0, symbolicCorridorSettledRegions: 0, symbolicCorridorHeapPops: 0, symbolicCorridorSlotArcsNotExpanded: 0, symbolicCorridorPlannedRoutes: 0, symbolicCorridorAssignedSlots: 0, symbolicCorridorAvoidedSlotAlternatives: 0 }
  const reject = (key: string): SymbolicCorridorResult => {
    stats[key]++
    return {
      applicable: false,
      nodes: [],
      stats,
    }
  }
  if (hasCoupledConstraints) return reject("symbolicCorridorUnsupportedCoupledConstraints")
  if (graph.ports.some((p) => p.d?._preloadedFixedNetIds?.length || p.d?._preloadedTracePortAssignments?.length) || graph.connections?.some(hasPreloadedTraceSectionMetadata)) return reject("symbolicCorridorUnsupportedPreloads")
  if (graph.regions.some((region) => region.assignments && region.assignments.length > 0)) return reject("symbolicCorridorUnsupportedAssignments")
  const regions = new Map(graph.regions.map((r) => [r.regionId, r]))
  const ports = new Map(graph.ports.map((p) => [p.portId, p]))
  const corridors: Corridor[] = []
  const byKey = new Map<string, Corridor>()
  const incident = new Map<string, Corridor[]>()
  for (const port of graph.ports) {
    if (port.d?._tinyTerminal) continue
    const [a, b] = [port.region1Id, port.region2Id].sort()
    const first = regions.get(a!), second = regions.get(b!)
    if (!first || !second) throw new Error("Symbolic corridor refers to a missing region")
    const z = port.d?.z
    if (!Number.isInteger(z) || !Number.isFinite(port.d?.x) || !Number.isFinite(port.d?.y)) throw new Error("Symbolic corridor has invalid port geometry")
    // Off-board and special virtual interfaces have no rectangular lane contract.
    if (first.d?._offBoardConnectionId || second.d?._offBoardConnectionId) return reject("symbolicCorridorOrderRejectedProblems")
    const key = JSON.stringify([a, b, z])
    let corridor = byKey.get(key)
    if (!corridor) {
      corridor = { id: key, a: a!, b: b!, z, ports: [], users: [], locked: Boolean(first.d?._containsTarget || second.d?._containsTarget || first.d?._containsObstacle || second.d?._containsObstacle), cost: Math.hypot(first.d.center.x - second.d.center.x, first.d.center.y - second.d.center.y), }
      byKey.set(key, corridor); corridors.push(corridor)
      for (const region of [a!, b!]) { const edges = incident.get(region) ?? []; edges.push(corridor); incident.set(region, edges) }
    }
    corridor.ports.push(port)
  }
  stats.symbolicCorridorCapacityEdges = corridors.length
  const plans: RoutePlan[] = []
  for (const connection of graph.connections ?? []) {
    const metadata = connection as typeof connection & { simpleRouteConnection?: SimpleRouteConnection }
    const id = connection.connectionId
    const start = ports.get(`tiny-terminal:start-port:${id}`), end = ports.get(`tiny-terminal:end-port:${id}`)
    if (!start || !end) throw new Error("Symbolic corridor is missing a route terminal")
    if (start.d.z !== end.d.z) return reject("symbolicCorridorUnsupportedLayers")
    const source = connection.startRegionId, target = connection.endRegionId, z = start.d.z
    if (!regions.has(source) || !regions.has(target)) throw new Error("Symbolic corridor route endpoint region is missing")
    const distance = new Map<string, number>([[source, 0]])
    const previous = new Map<string, { region: string; corridor: Corridor }>()
    const open = new PriorityQueue<{ region: string; distance: number; f: number }>([{ region: source, distance: 0, f: 0 }], Infinity)
    const closed = new Set<string>()
    while (!open.isEmpty()) {
      const entry = open.dequeue()
      if (!entry) throw new Error("Symbolic corridor open-set invariant failed")
      stats.symbolicCorridorHeapPops++
      const current = entry.region
      if (closed.has(current) || entry.distance !== distance.get(current)) continue
      closed.add(current); stats.symbolicCorridorSettledRegions++
      if (current === target) break
      for (const corridor of incident.get(current) ?? []) {
        if (corridor.z !== z || corridor.users.length >= corridor.ports.length) continue
        const next = corridor.a === current ? corridor.b : corridor.a
        if (closed.has(next)) continue
        const region = regions.get(next)!
        if (!region.d.availableZ?.includes(z)) continue
        if (next !== target && next !== source && (region.d._containsObstacle || region.d._containsTarget)) continue
        stats.symbolicCorridorGraphRelaxations++
        stats.symbolicCorridorSlotArcsNotExpanded += Math.max(0, corridor.ports.length - corridor.users.length - 1)
        // Capacity is exact in the original slot pool. This convex congestion
        // surcharge prefers spare corridors without expanding individual slots.
        const cost = distance.get(current)! + Math.max(EPS, corridor.cost) * (1 + corridor.users.length / corridor.ports.length)
        if (!distance.has(next) || cost < distance.get(next)!) {
          distance.set(next, cost); previous.set(next, { region: current, corridor })
          const targetCenter = regions.get(target)!.d.center
          const heuristic = Math.hypot(region.d.center.x - targetCenter.x, region.d.center.y - targetCenter.y)
          open.enqueue({ region: next, distance: cost, f: cost + heuristic })
        }
      }
    }
    if (!closed.has(target)) return reject("symbolicCorridorCapacityRejectedProblems")
    const pathRegions = [target], pathCorridors: Corridor[] = []
    let current = target
    while (current !== source) {
      const entry = previous.get(current)
      if (!entry) throw new Error("Symbolic corridor predecessor chain is incomplete")
      pathCorridors.push(entry.corridor); pathRegions.push(entry.region); current = entry.region
    }
    pathRegions.reverse(); pathCorridors.reverse()
    const plan: RoutePlan = { id, name: metadata.simpleRouteConnection?.name ?? id, root: metadata.simpleRouteConnection?.__rootConnectionNames?.[0] ?? connection.mutuallyConnectedNetworkId ?? id, z, regions: pathRegions, corridors: pathCorridors, start, end }
    const index = plans.length
    plans.push(plan)
    for (const corridor of pathCorridors) corridor.users.push(index)
    stats.symbolicCorridorPlannedRoutes++
  }
  const assigned = new Map<string, Map<number, PortPoint>>()
  const laneGroups: Array<{ id: string; points: PortPoint[]; locked: boolean }> = []
  for (const corridor of corridors) {
    if (corridor.users.length === 0) continue
    // All movable slots must lie on one straight physical interface. Otherwise
    // preserve singleton lanes and let the final certificate reject crossings.
    const xRange = Math.max(...corridor.ports.map((p) => p.d.x)) - Math.min(...corridor.ports.map((p) => p.d.x))
    const yRange = Math.max(...corridor.ports.map((p) => p.d.y)) - Math.min(...corridor.ports.map((p) => p.d.y))
    const vertical = xRange < EPS
    const straight = vertical || yRange < EPS
    const available = [...corridor.ports].sort((a, b) => vertical ? a.d.y - b.d.y : a.d.x - b.d.x)
    const terminalProjection = (index: number): number => {
      const plan = plans[index]!
      const first = plan.regions[0], last = plan.regions.at(-1)
      const terminal = first === corridor.a || first === corridor.b ? plan.start : last === corridor.a || last === corridor.b ? plan.end : undefined
      if (terminal) return vertical ? terminal.d.y : terminal.d.x
      return 0
    }
    const users = [...corridor.users].sort((a, b) => corridor.locked ? terminalProjection(a) - terminalProjection(b) || plans[a]!.name.localeCompare(plans[b]!.name) : plans[a]!.name.localeCompare(plans[b]!.name))
    const groupPoints: PortPoint[] = [], byRoute = new Map<number, PortPoint>()
    for (let i = 0; i < users.length; i++) {
      const plan = plans[users[i]!]!
      const slot = available[Math.floor((i + 0.5) * available.length / users.length)]!
      const point: PortPoint = { portPointId: slot.portId, connectionName: plan.name, rootConnectionName: plan.root, x: slot.d.x, y: slot.d.y, z: plan.z }
      byRoute.set(users[i]!, point); groupPoints.push(point)
      stats.symbolicCorridorAssignedSlots++
      stats.symbolicCorridorAvoidedSlotAlternatives += corridor.ports.length - 1
    }
    assigned.set(corridor.id, byRoute)
    laneGroups.push({ id: corridor.id, points: groupPoints, locked: corridor.locked || !straight })
  }
  const nodesById = new Map<string, NodeWithPortPoints>()
  for (let route = 0; route < plans.length; route++) {
    const plan = plans[route]!
    const terminal = (port: SerializedPort): PortPoint => ({
      portPointId: port.portId,
      connectionName: plan.name,
      rootConnectionName: plan.root,
      x: port.d.x,
      y: port.d.y,
      z: port.d.z,
      ...(typeof port.d.pcb_port_id === "string" ? { pcb_port_id: port.d.pcb_port_id } : {}),
    })
    for (let i = 0; i < plan.regions.length; i++) {
      const regionId = plan.regions[i]!, region = regions.get(regionId)!
      let node = nodesById.get(regionId)
      if (!node) {
        node = { capacityMeshNodeId: region.d.capacityMeshNodeId, center: { ...region.d.center }, width: region.d.width, height: region.d.height, availableZ: [...region.d.availableZ], portPoints: [], portPointsInPairs: [] }
        nodesById.set(regionId, node)
      }
      const a = i === 0 ? terminal(plan.start) : { ...assigned.get(plan.corridors[i - 1]!.id)!.get(route)! }
      const b = i === plan.regions.length - 1 ? terminal(plan.end) : { ...assigned.get(plan.corridors[i]!.id)!.get(route)! }
      if (!a.portPointId || !b.portPointId) throw new Error("Symbolic corridor lost a concrete slot assignment")
      a.nextPortPointId = b.portPointId; b.prevPortPointId = a.portPointId
      node.portPoints.push(a, b); node.portPointsInPairs!.push([a, b])
    }
  }
  const realized = realizeSymbolicLaneOrders([...nodesById.values()], laneGroups)
  Object.assign(stats, realized.stats)
  if (!realized.compatible) return reject("symbolicCorridorOrderRejectedProblems")
  // Every allocated crossing must retain its net identity on both owner sides.
  const copies = new Map<string, PortPoint>()
  for (const node of realized.nodes) for (const point of node.portPoints) {
    const previous = copies.get(point.portPointId!)
    if (previous && (previous.connectionName !== point.connectionName || previous.x !== point.x || previous.y !== point.y || previous.z !== point.z)) throw new Error("Symbolic corridor interface continuity failed")
    copies.set(point.portPointId!, point)
  }
  stats.symbolicCorridorAcceptedProblems = 1
  return { applicable: true, nodes: realized.nodes, stats }
}
