import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import type { ReservedRoutingTerminal } from "lib/solvers/HyperHighDensitySolver/createIntraNodeSegmentValidator"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

type RegionalRoutingContext = {
  nodes: NodeWithPortPoints[]
  plannedNode: NodeWithPortPoints
  routingNode: NodeWithPortPoints
  reservedTerminals: readonly ReservedRoutingTerminal[]
}

type PlannedVertex = { point: PortPoint; neighbors: Set<string>; connectionNames: Set<string> }

/**
 * Board-world mm (+X right, +Y up). Join the planned paths incident to an
 * expanded region, retaining their external terminals and physical pad anchors.
 * Interior graph crossings are routing choices, rather than fixed copper.
 */
export function getRegionalRoutingContext({
  node,
  routingNode,
  plannedNodes,
  reservedTerminals,
  requiredNodeIds,
}: {
  node: NodeWithPortPoints
  routingNode: NodeWithPortPoints
  plannedNodes: Iterable<NodeWithPortPoints>
  requiredNodeIds: ReadonlySet<string>
  reservedTerminals: readonly ReservedRoutingTerminal[]
}): RegionalRoutingContext {
  const bounds = {
    minX: routingNode.center.x - routingNode.width / 2,
    maxX: routingNode.center.x + routingNode.width / 2,
    minY: routingNode.center.y - routingNode.height / 2,
    maxY: routingNode.center.y + routingNode.height / 2,
  }
  const allNodes = [...plannedNodes]
  const nodes = allNodes.filter((planned) =>
    planned.capacityMeshNodeId === node.capacityMeshNodeId ||
    requiredNodeIds.has(planned.capacityMeshNodeId) ||
    planned.portPoints.some((point) =>
      point.x > bounds.minX + 1e-9 && point.x < bounds.maxX - 1e-9 &&
      point.y > bounds.minY + 1e-9 && point.y < bounds.maxY - 1e-9,
    ),
  )
  if (nodes.length < 2) return {
    nodes: [node], plannedNode: node, routingNode, reservedTerminals,
  }

  const graph = new Map<string, PlannedVertex>()
  for (const planned of nodes) {
    const connections = new Map<string, PortPoint[]>()
    for (const point of planned.portPoints) {
      const points = connections.get(point.connectionName) ?? []
      points.push(point)
      connections.set(point.connectionName, points)
    }
    const segments = planned.portPointsInPairs ?? [...connections.values()]
      .flatMap(points => getConnectionPortPointPairs(points))
    for (const [start, end] of segments) {
      const keys: string[] = []
      for (const point of [start, end]) {
        const key = `${point.rootConnectionName ?? point.connectionName}|${point.x.toFixed(9)},${point.y.toFixed(9)},${point.z}`
        const vertex = graph.get(key) ?? {
          point, neighbors: new Set<string>(), connectionNames: new Set<string>(),
        }
        if (point.pcb_port_id) vertex.point = point
        vertex.connectionNames.add(point.connectionName)
        graph.set(key, vertex)
        keys.push(key)
      }
      graph.get(keys[0]!)!.neighbors.add(keys[1]!)
      graph.get(keys[1]!)!.neighbors.add(keys[0]!)
    }
  }
  const retainedKeys = new Set<string>()
  const selectedIds = new Set(nodes.map(planned => planned.capacityMeshNodeId))
  for (const planned of allNodes) {
    if (selectedIds.has(planned.capacityMeshNodeId)) continue
    for (const point of planned.portPoints) {
      retainedKeys.add(`${point.rootConnectionName ?? point.connectionName}|${point.x.toFixed(9)},${point.y.toFixed(9)},${point.z}`)
    }
  }
  for (const [key, vertex] of graph) {
    if (vertex.neighbors.size <= 1 || vertex.point.pcb_port_id) retainedKeys.add(key)
  }

  // Internal junctions and the original MST edges are routing choices. Each
  // net component must preserve its physical and external anchors, rather
  // than the particular branches used to reach them in the coarse graph.
  const pairs: [PortPoint, PortPoint][] = []
  const visited = new Set<string>()
  for (const [startKey] of graph) {
    if (visited.has(startKey)) continue
    const pending = [startKey]
    const anchors: PortPoint[] = []
    const names = new Set<string>()
    while (pending.length > 0) {
      const key = pending.pop()!
      if (visited.has(key)) continue
      visited.add(key)
      const vertex = graph.get(key)!
      if (retainedKeys.has(key)) anchors.push(vertex.point)
      for (const name of vertex.connectionNames) names.add(name)
      for (const next of vertex.neighbors) if (!visited.has(next)) pending.push(next)
    }
    const byPosition = new Map<string, PortPoint[]>()
    for (const point of anchors) {
      const key = `${point.x.toFixed(9)},${point.y.toFixed(9)}`
      const points = byPosition.get(key) ?? []
      points.push(point)
      byPosition.set(key, points)
    }
    const representatives = [...byPosition.values()].map(points => points[0]!)
    const edges: [PortPoint, PortPoint][] = buildMinimumSpanningTree(representatives)
      .map(edge => [edge.from, edge.to])
    // The existing XY tree deliberately treats coincident points as one.
    // Retain their real layer anchors with explicit layer-transition pairs.
    for (const points of byPosition.values()) {
      for (const point of points.slice(1)) edges.push([points[0]!, point])
    }
    const connectionNames = [...names]
    for (const [edgeIndex, [start, end]] of edges.entries()) {
      const connectionName = connectionNames[edgeIndex % connectionNames.length]!
      const startId = start.portPointId ?? `regional:${node.capacityMeshNodeId}:${pairs.length}:start`
      const endId = end.portPointId ?? `regional:${node.capacityMeshNodeId}:${pairs.length}:end`
      pairs.push([
        { ...start, connectionName, portPointId: startId,
          prevPortPointId: undefined, nextPortPointId: endId },
        { ...end, connectionName, portPointId: endId,
          prevPortPointId: startId, nextPortPointId: undefined },
      ])
    }
  }

  const cuts = routingNode.portPoints.slice(node.portPoints.length)
  const ports = pairs.flat()
  for (const point of [...ports, ...cuts]) {
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxY = Math.max(bounds.maxY, point.y)
  }
  const plannedNode = {
    ...routingNode,
    center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    portPoints: ports,
    portPointsInPairs: pairs,
  }
  const cutKeys = new Set(cuts.map((point) => point.portPointId))
  const cutPairs = routingNode.portPointsInPairs?.filter(([point]) => cutKeys.has(point.portPointId)) ?? []
  return {
    nodes,
    plannedNode,
    routingNode: { ...plannedNode, portPoints: [...ports, ...cuts], portPointsInPairs: [...pairs, ...cutPairs] },
    reservedTerminals: reservedTerminals.filter((point) => {
      const key = `${point.rootConnectionName ?? point.connectionName}|${point.x.toFixed(9)},${point.y.toFixed(9)},${point.z}`
      return !graph.has(key) || retainedKeys.has(key)
    }),
  }
}
