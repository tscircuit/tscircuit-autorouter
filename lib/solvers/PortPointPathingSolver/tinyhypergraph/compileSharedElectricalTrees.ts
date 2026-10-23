import type { SimpleRouteConnection } from "lib/types"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

export type SharedElectricalEdge = {
  id: string
  nodeId: string
  from: string
  to: string
  owners: string[]
}

export type SharedElectricalTreeOutput = {
  nodesWithPortPoints: NodeWithPortPoints[]
  connections: SimpleRouteConnection[]
  edges: SharedElectricalEdge[]
  stats: Record<string, number>
}

type Vertex = { id: string; point: PortPoint; edges: Edge[] }
type Edge = SharedElectricalEdge & { net: string; a: Vertex; b: Vertex }
type Net = { vertices: Map<string, Vertex>; edges: Map<string, Edge>; demands: SimpleRouteConnection[] }

/**
 * Pair paths are demand/ownership views. Copper is their shared undirected
 * net-edge graph. Compile it once into a tree and route each physical branch
 * once, including branches ending at ordinary (non-PCB) junctions.
 */
export function compileSharedElectricalTrees(input: {
  nodes: NodeWithPortPoints[]
  connections: SimpleRouteConnection[]
  netByConnection: ReadonlyMap<string, string>
  excludedConnections: ReadonlySet<string>
  demandEndpoints: ReadonlyMap<string, readonly [string, string]>
  layerCount: number
}): SharedElectricalTreeOutput {
  const nets = new Map<string, Net>()
  const sourceByName = new Map(input.connections.map((connection) => [connection.name, connection]))
  const sourceNodes = new Map(input.nodes.map((node) => [node.capacityMeshNodeId, node]))
  const outputPairs = new Map<string, Array<[PortPoint, PortPoint]>>()
  const connections: SimpleRouteConnection[] = []
  const edges: SharedElectricalEdge[] = []
  const stats = {
    electricalTreeLogicalEdgeReferenceCount: 0,
    electricalTreeSharedEdgeCount: 0,
    electricalTreeRemovedCycleEdgeCount: 0,
    electricalTreePhysicalEdgeCount: 0,
    electricalTreePhysicalBranchCount: 0,
    electricalTreeVerifiedDemandCount: 0,
    electricalTreeJunctionCount: 0,
  }
  for (const connection of input.connections) {
    if (input.excludedConnections.has(connection.name)) continue
    const netId = input.netByConnection.get(connection.name)
    if (netId === undefined) throw new Error(`Electrical tree lost net for ${connection.name}`)
    let net = nets.get(netId)
    if (!net) {
      net = { vertices: new Map(), edges: new Map(), demands: [] }
      nets.set(netId, net)
    }
    net.demands.push(connection)
  }
  for (const node of input.nodes) {
    for (const pair of node.portPointsInPairs ?? []) {
      const name = pair[0].connectionName
      if (pair[1].connectionName !== name) throw new Error("Electrical tree edge has mixed owners")
      if (input.excludedConnections.has(name)) {
        const pairs = outputPairs.get(node.capacityMeshNodeId) ?? []
        pairs.push(pair)
        outputPairs.set(node.capacityMeshNodeId, pairs)
        continue
      }
      const netId = input.netByConnection.get(name)
      const net = netId === undefined ? undefined : nets.get(netId)
      if (!net || netId === undefined || !sourceByName.has(name)) {
        throw new Error(`Electrical tree edge has unknown demand ${name}`)
      }
      const vertices = pair.map((point): Vertex => {
        const id = point.electricalVertexId
        if (!id || ![point.x, point.y, point.z].every(Number.isFinite)) {
          throw new Error(`Electrical tree edge has invalid physical vertex for ${name}`)
        }
        const previous = net.vertices.get(id)
        if (previous) {
          if (previous.point.x !== point.x || previous.point.y !== point.y || previous.point.z !== point.z ||
            previous.point.electricalTerminalId !== point.electricalTerminalId) {
            throw new Error(`Electrical tree vertex ${id} has inconsistent physical witnesses`)
          }
          return previous
        }
        const vertex: Vertex = { id, point: { ...point }, edges: [] }
        net.vertices.set(id, vertex)
        return vertex
      })
      const [a, b] = vertices as [Vertex, Vertex]
      stats.electricalTreeLogicalEdgeReferenceCount++
      // Distinct private terminal ports for one certified pad are the same
      // physical vertex. Their connector has no copper to route.
      if (a.id === b.id) continue
      const id = JSON.stringify([node.capacityMeshNodeId, ...[a.id, b.id].sort()])
      const existing = net.edges.get(id)
      if (existing) {
        if (!existing.owners.includes(name)) existing.owners.push(name)
      } else {
        net.edges.set(id, { id, nodeId: node.capacityMeshNodeId, from: a.id, to: b.id, owners: [name], net: netId, a, b })
      }
    }
  }
  const usedNames = new Set(input.connections.map((connection) => connection.name))
  for (const [netId, net] of nets) {
    const parent = new Map([...net.vertices.keys()].map((id) => [id, id]))
    const find = (id: string): string => {
      let root = id
      while (parent.get(root) !== root) {
        const next = parent.get(root)
        if (next === undefined) throw new Error(`Electrical tree lost vertex ${root}`)
        root = next
      }
      let cursor = id
      while (cursor !== root) {
        const next = parent.get(cursor)!
        parent.set(cursor, root)
        cursor = next
      }
      return root
    }
    const sortedEdges = [...net.edges.values()].sort((a, b) => {
      const lengthA = Math.hypot(a.a.point.x - a.b.point.x, a.a.point.y - a.b.point.y)
      const lengthB = Math.hypot(b.a.point.x - b.b.point.x, b.a.point.y - b.b.point.y)
      return lengthA - lengthB || a.id.localeCompare(b.id)
    })
    for (const edge of sortedEdges) {
      if (edge.owners.length > 1) stats.electricalTreeSharedEdgeCount++
      const rootA = find(edge.a.id)
      const rootB = find(edge.b.id)
      if (rootA === rootB) {
        stats.electricalTreeRemovedCycleEdgeCount++
        continue
      }
      parent.set(rootA, rootB)
      edge.a.edges.push(edge)
      edge.b.edges.push(edge)
      edges.push({ id: edge.id, nodeId: edge.nodeId, from: edge.from, to: edge.to, owners: [...edge.owners] })
    }
    for (const demand of net.demands) {
      const endpointIds = input.demandEndpoints.get(demand.name)
      if (!endpointIds || endpointIds.some((id) => !net.vertices.has(id))) {
        throw new Error(`Electrical tree cannot resolve terminal of ${demand.name}`)
      }
      if (find(endpointIds[0]) !== find(endpointIds[1])) {
        throw new Error(`Electrical tree disconnects original demand ${demand.name}`)
      }
      stats.electricalTreeVerifiedDemandCount++
    }
    const visited = new Set<string>()
    const branchVertices = [...net.vertices.values()].filter((vertex) =>
      vertex.edges.length !== 2 || vertex.point.electricalTerminalId !== undefined,
    ).sort((a, b) => a.id.localeCompare(b.id))
    for (const start of branchVertices) {
      if (start.edges.length > 2) stats.electricalTreeJunctionCount++
      for (const first of start.edges) {
        if (visited.has(first.id)) continue
        const path: Array<{ edge: Edge; from: Vertex; to: Vertex }> = []
        let from = start
        let edge = first
        let end: Vertex
        while (true) {
          if (visited.has(edge.id)) throw new Error(`Electrical tree revisited edge ${edge.id}`)
          visited.add(edge.id)
          end = edge.a.id === from.id ? edge.b : edge.a
          path.push({ edge, from, to: end })
          if (end.edges.length !== 2 || end.point.electricalTerminalId !== undefined) break
          const next = end.edges.find((candidate) => candidate.id !== edge.id)
          if (!next) throw new Error(`Electrical tree lost continuation at ${end.id}`)
          from = end
          edge = next
        }
        const owners = [...new Set(path.flatMap((segment) => segment.edge.owners))].sort()
        const source = sourceByName.get(owners[0]!)
        if (!source) throw new Error(`Electrical tree branch has unknown owner in ${netId}`)
        let name = source.name
        if (connections.some((connection) => connection.name === name)) {
          let ordinal = 1
          while (usedNames.has(`${source.name}__tree_${ordinal}`)) ordinal++
          name = `${source.name}__tree_${ordinal}`
        }
        usedNames.add(name)
        const pointsToConnect = [start, end!].map((vertex) => ({
          x: vertex.point.x,
          y: vertex.point.y,
          layer: mapZToLayerName(vertex.point.z, input.layerCount),
          pointId: vertex.point.electricalTerminalId ?? vertex.id,
          ...(vertex.point.electricalTerminalId ? { pcb_port_id: vertex.point.electricalTerminalId } : {}),
        }))
        const widths = net.demands.map((demand) => demand.nominalTraceWidth)
          .filter((width): width is number => width !== undefined)
        connections.push({ ...source, name, pointsToConnect,
          ...(widths.length > 0 ? { nominalTraceWidth: Math.max(...widths) } : {}),
          electricalBranch: { netId, startVertexId: start.id, endVertexId: end!.id, logicalConnectionNames: owners },
        })
        for (const segment of path) {
          const startPoint: PortPoint = { ...segment.from.point, connectionName: name, pcb_port_id: segment.from.point.electricalTerminalId }
          const endPoint: PortPoint = { ...segment.to.point, connectionName: name, pcb_port_id: segment.to.point.electricalTerminalId }
          startPoint.nextPortPointId = endPoint.portPointId
          endPoint.prevPortPointId = startPoint.portPointId
          const pairs = outputPairs.get(segment.edge.nodeId) ?? []
          pairs.push([startPoint, endPoint])
          outputPairs.set(segment.edge.nodeId, pairs)
        }
      }
    }
    if (visited.size !== [...net.vertices.values()].reduce((sum, vertex) => sum + vertex.edges.length, 0) / 2) {
      throw new Error(`Electrical tree has an unrepresented physical component in ${netId}`)
    }
  }
  stats.electricalTreePhysicalEdgeCount = edges.length
  stats.electricalTreePhysicalBranchCount = connections.length
  const nodesWithPortPoints = [...outputPairs].map(([nodeId, pairs]) => {
    const node = sourceNodes.get(nodeId)
    if (!node) throw new Error(`Electrical tree lost node ${nodeId}`)
    return { ...node, portPointsInPairs: pairs, portPoints: pairs.flat() }
  })
  return { nodesWithPortPoints, connections, edges, stats }
}
