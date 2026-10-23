import type { ElectricalTreeTerminalWitness, Obstacle, SimpleRouteConnection } from "lib/types"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { certifyElectricalTreePadAttachment } from "./certifyElectricalTreePadAttachment"

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
  padAttachmentWitnesses: Array<{ netId: string; attachmentVertexId: string; padVertexId: string; obstacleIndex: number }>
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
  obstacles?: readonly Obstacle[]
  nativeNetIds?: ReadonlySet<string>
}): SharedElectricalTreeOutput {
  const nets = new Map<string, Net>()
  const nativeDemands = new Map<string, SimpleRouteConnection>()
  const nativeGraph = new Map<string, Map<string, { point: PortPoint; neighbors: Set<string> }>>()
  const sourceByName = new Map(input.connections.map((connection) => [connection.name, connection]))
  if (sourceByName.size !== input.connections.length) throw new Error("Electrical tree received duplicate original demand names")
  const sourceNodes = new Map(input.nodes.map((node) => [node.capacityMeshNodeId, node]))
  const outputPairs = new Map<string, Array<[PortPoint, PortPoint]>>()
  const connections: SimpleRouteConnection[] = []
  const edges: SharedElectricalEdge[] = []
  const padAttachmentWitnesses: SharedElectricalTreeOutput["padAttachmentWitnesses"] = []
  const stats = {
    electricalTreeLogicalEdgeReferenceCount: 0,
    electricalTreeSharedEdgeCount: 0,
    electricalTreeRemovedCycleEdgeCount: 0,
    electricalTreePhysicalEdgeCount: 0,
    electricalTreePhysicalBranchCount: 0,
    electricalTreeVerifiedDemandCount: 0,
    electricalTreeJunctionCount: 0,
    electricalTreeCertifiedPadAttachmentCount: 0,
    electricalTreeDemandPathEdgeReferences: 0,
    electricalTreeRemovedUnownedEdgeCount: 0,
    electricalTreeNativePathNetCount: 0,
    electricalTreeNativePathDemandCount: 0,
  }
  for (const connection of input.connections) {
    if (input.excludedConnections.has(connection.name)) continue
    const netId = input.netByConnection.get(connection.name)
    if (netId === undefined) throw new Error(`Electrical tree lost net for ${connection.name}`)
    if (input.nativeNetIds?.has(netId)) {
      nativeDemands.set(connection.name, connection)
      continue
    }
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
      if (nativeDemands.has(name)) {
        const graph = nativeGraph.get(name) ?? new Map<string, { point: PortPoint; neighbors: Set<string> }>()
        for (const point of pair) {
          const id = point.electricalVertexId
          if (!id || ![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`Native electrical path has an invalid vertex for ${name}`)
          const previous = graph.get(id)
          if (previous && (previous.point.x !== point.x || previous.point.y !== point.y || previous.point.z !== point.z)) throw new Error(`Native electrical path has inconsistent vertex ${id}`)
          if (!previous) graph.set(id, { point, neighbors: new Set() })
        }
        graph.get(pair[0].electricalVertexId!)!.neighbors.add(pair[1].electricalVertexId!)
        graph.get(pair[1].electricalVertexId!)!.neighbors.add(pair[0].electricalVertexId!)
        nativeGraph.set(name, graph)
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
    const originalTerminals = new Map<string, ElectricalTreeTerminalWitness>()
    for (const demand of net.demands) {
      const endpointIds = input.demandEndpoints.get(demand.name)
      if (!endpointIds || demand.pointsToConnect.length !== 2) throw new Error(`Electrical tree lost original terminal provenance for ${demand.name}`)
      for (const endpoint of [0, 1] as const) {
        const vertex = net.vertices.get(endpointIds[endpoint]), source = demand.pointsToConnect[endpoint]!
        if (!vertex) throw new Error(`Electrical tree cannot resolve terminal (original SRJ witness) of ${demand.name}`)
        const layer = mapZToLayerName(vertex.point.z, input.layerCount)
        if (source.x !== vertex.point.x || source.y !== vertex.point.y || !getConnectionPointLayers(source).includes(layer) ||
          (source.pcb_port_id !== undefined && source.pcb_port_id !== vertex.point.electricalTerminalId)) throw new Error(`Electrical tree changed original terminal of ${demand.name}`)
        if (vertex.point.electricalTerminalId !== undefined) continue
        const witness: ElectricalTreeTerminalWitness = { sourceConnectionName: demand.name, sourceEndpointIndex: endpoint,
          sourcePointId: source.pointId ?? null, x: source.x, y: source.y, z: vertex.point.z, layer }
        const previous = originalTerminals.get(vertex.id)
        if (previous && (previous.x !== witness.x || previous.y !== witness.y || previous.layer !== witness.layer)) throw new Error(`Electrical tree original terminals disagree at ${vertex.id}`)
        if (!previous) originalTerminals.set(vertex.id, Object.freeze(witness))
      }
    }
    const padAliases = new Map<string, Vertex>()
    const padWitnesses = new Map<string, SharedElectricalTreeOutput["padAttachmentWitnesses"][number]>()
    const ambiguousAttachments = new Set<string>()
    // Native local tasks deduplicate rounded XYZ sites. Normalize only an
    // existing graph edge with a real pad-body witness, before that boundary;
    // unrelated coincident sites and genuinely distinct attachments stay live.
    for (const edge of net.edges.values()) {
      for (const [terminal, attachment] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
        if (ambiguousAttachments.has(attachment.id)) continue
        const obstacleIndex = certifyElectricalTreePadAttachment({ terminal: terminal.point,
          attachment: attachment.point, obstacles: input.obstacles ?? [], layerCount: input.layerCount })
        if (obstacleIndex === undefined) continue
        const previous = padAliases.get(attachment.id)
        if (previous && previous.id !== terminal.id) {
          // Two immutable terminal identities need an explicit conductor-body
          // union representation. Keep both live rather than choose one pad.
          padAliases.delete(attachment.id)
          padWitnesses.delete(attachment.id)
          ambiguousAttachments.add(attachment.id)
          continue
        }
        padAliases.set(attachment.id, terminal)
        padWitnesses.set(attachment.id, { netId, attachmentVertexId: attachment.id, padVertexId: terminal.id, obstacleIndex })
      }
    }
    padAttachmentWitnesses.push(...padWitnesses.values())
    if (padAliases.size > 0) {
      const normalizedEdges = new Map<string, Edge>()
      for (const edge of net.edges.values()) {
        const a = padAliases.get(edge.a.id) ?? edge.a, b = padAliases.get(edge.b.id) ?? edge.b
        if (a.id === b.id) continue
        const id = JSON.stringify([edge.nodeId, ...[a.id, b.id].sort()])
        const previous = normalizedEdges.get(id)
        if (previous) previous.owners = [...new Set([...previous.owners, ...edge.owners])]
        else normalizedEdges.set(id, { ...edge, id, from: a.id, to: b.id, a, b })
      }
      net.edges = normalizedEdges
    }
    const parent = new Map([...net.vertices.keys()].map((id) => [id, id]))
    for (const [alias, terminal] of padAliases) parent.set(alias, terminal.id)
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
    const keptEdges: Edge[] = []
    for (const edge of sortedEdges) {
      const rootA = find(edge.a.id)
      const rootB = find(edge.b.id)
      if (rootA === rootB) {
        stats.electricalTreeRemovedCycleEdgeCount++
        continue
      }
      parent.set(rootA, rootB)
      edge.a.edges.push(edge)
      edge.b.edges.push(edge)
      edge.owners = []
      keptEdges.push(edge)
    }
    const depth = new Map<string, number>()
    const treeParent = new Map<string, string>()
    const parentEdge = new Map<string, Edge>()
    for (const root of net.vertices.values()) {
      if (depth.has(root.id) || padAliases.has(root.id)) continue
      depth.set(root.id, 0)
      const pending = [root]
      while (pending.length > 0) {
        const vertex = pending.pop()!
        for (const edge of vertex.edges) {
          if (parentEdge.get(vertex.id) === edge) continue
          const next = edge.a.id === vertex.id ? edge.b : edge.a
          if (depth.has(next.id)) throw new Error(`Electrical tree retained a cycle at ${next.id}`)
          depth.set(next.id, depth.get(vertex.id)! + 1)
          treeParent.set(next.id, vertex.id)
          parentEdge.set(next.id, edge)
          pending.push(next)
        }
      }
    }
    for (const demand of net.demands) {
      const endpointIds = input.demandEndpoints.get(demand.name)
      if (!endpointIds || endpointIds.some((id) => !net.vertices.has(id))) {
        throw new Error(`Electrical tree cannot resolve terminal of ${demand.name}`)
      }
      if (find(endpointIds[0]) !== find(endpointIds[1])) {
        throw new Error(`Electrical tree disconnects original demand ${demand.name}`)
      }
      // Removing cycles changes the unique path of some original demands.
      // Re-project every demand onto this tree before assigning copper width
      // or ownership; the old path's edge references are no longer a proof.
      let a = padAliases.get(endpointIds[0])?.id ?? endpointIds[0]
      let b = padAliases.get(endpointIds[1])?.id ?? endpointIds[1]
      while (a !== b) {
        const from = depth.get(a)! >= depth.get(b)! ? a : b
        const edge = parentEdge.get(from), next = treeParent.get(from)
        if (!edge || next === undefined) throw new Error(`Electrical tree cannot project demand ${demand.name}`)
        edge.owners.push(demand.name)
        stats.electricalTreeDemandPathEdgeReferences++
        if (from === a) a = next
        else b = next
      }
      stats.electricalTreeVerifiedDemandCount++
    }
    for (const edge of keptEdges) {
      if (edge.owners.length === 0) {
        stats.electricalTreeRemovedUnownedEdgeCount++
        continue
      }
      edge.owners.sort()
      if (edge.owners.length > 1) stats.electricalTreeSharedEdgeCount++
      edges.push({ id: edge.id, nodeId: edge.nodeId, from: edge.from, to: edge.to, owners: [...edge.owners] })
    }
    for (const vertex of net.vertices.values()) vertex.edges = vertex.edges.filter((edge) => edge.owners.length > 0)
    const visited = new Set<string>()
    const branchVertices = [...net.vertices.values()].filter((vertex) =>
      vertex.edges.length !== 2 || vertex.point.electricalTerminalId !== undefined || originalTerminals.has(vertex.id) ||
      JSON.stringify(vertex.edges[0]!.owners) !== JSON.stringify(vertex.edges[1]!.owners),
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
          if (end.edges.length !== 2 || end.point.electricalTerminalId !== undefined || originalTerminals.has(end.id) ||
            JSON.stringify(end.edges[0]!.owners) !== JSON.stringify(end.edges[1]!.owners)) break
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
          pointId: vertex.point.electricalTerminalId ?? originalTerminals.get(vertex.id)?.sourcePointId ?? vertex.id,
          ...(vertex.point.electricalTerminalId ? { pcb_port_id: vertex.point.electricalTerminalId } : {}),
        }))
        const widths = owners.map((owner) => {
          const demand = sourceByName.get(owner)
          if (!demand) throw new Error(`Electrical tree width has unknown demand ${owner}`)
          const width = demand.nominalTraceWidth
          if (width !== undefined && (!Number.isFinite(width) || width <= 0)) throw new Error(`Electrical tree has invalid width for ${owner}`)
          return width
        })
          .filter((width): width is number => width !== undefined)
        connections.push({ ...source, name, pointsToConnect,
          ...(widths.length > 0 ? { nominalTraceWidth: Math.max(...widths) } : {}),
          electricalBranch: { netId, startVertexId: start.id, endVertexId: end!.id, logicalConnectionNames: owners,
            ...((originalTerminals.has(start.id) || originalTerminals.has(end!.id)) ? { originalTerminals: {
              ...(originalTerminals.has(start.id) ? { start: originalTerminals.get(start.id)! } : {}),
              ...(originalTerminals.has(end!.id) ? { end: originalTerminals.get(end!.id)! } : {}),
            } } : {}),
          },
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
  const nativeNets = new Set<string>()
  for (const [name, demand] of nativeDemands) {
    const endpointIds = input.demandEndpoints.get(name), graph = nativeGraph.get(name)
    if (!endpointIds || !graph || demand.pointsToConnect.length !== 2) throw new Error(`Native electrical path lost original demand ${name}`)
    const reached = new Set<string>(), pending = [endpointIds[0]]
    while (pending.length > 0) {
      const id = pending.pop()!
      if (reached.has(id)) continue
      const vertex = graph.get(id)
      if (!vertex) throw new Error(`Native electrical path lost vertex ${id}`)
      reached.add(id)
      pending.push(...vertex.neighbors)
    }
    if (!reached.has(endpointIds[1])) throw new Error(`Native electrical path disconnects original demand ${name}`)
    for (const endpoint of [0, 1] as const) {
      const expected = demand.pointsToConnect[endpoint]!, actual = graph.get(endpointIds[endpoint])!.point
      if (actual.x !== expected.x || actual.y !== expected.y || !getConnectionPointLayers(expected).includes(mapZToLayerName(actual.z, input.layerCount)) ||
        (expected.pcb_port_id !== undefined && actual.electricalTerminalId !== expected.pcb_port_id)) throw new Error(`Native electrical path changed original terminal of ${name}`)
    }
    const netId = input.netByConnection.get(name)!
    nativeNets.add(netId)
    // Original name, width and all declared path-level constraints stay
    // intact. Bind only the physical view to the selected legal layer; the
    // original logical demand retains its full allowed-layer declaration.
    const originalTerminals: NonNullable<NonNullable<SimpleRouteConnection["electricalBranch"]>["originalTerminals"]> = {}
    for (const endpoint of [0, 1] as const) {
      const source = demand.pointsToConnect[endpoint]!, actual = graph.get(endpointIds[endpoint])!.point
      if (source.pcb_port_id !== undefined) continue
      originalTerminals[endpoint === 0 ? "start" : "end"] = Object.freeze({ sourceConnectionName: name, sourceEndpointIndex: endpoint,
        sourcePointId: source.pointId ?? null, x: source.x, y: source.y, z: actual.z,
        layer: mapZToLayerName(actual.z, input.layerCount) })
    }
    const pointsToConnect = demand.pointsToConnect.map((source, endpoint) => {
      const { layers: _allowedLayers, ...point } = source
      return { ...point, layer: mapZToLayerName(graph.get(endpointIds[endpoint]!)!.point.z, input.layerCount) }
    })
    connections.push({ ...demand, pointsToConnect, electricalBranch: { netId, startVertexId: endpointIds[0], endVertexId: endpointIds[1], logicalConnectionNames: [name], nativeLogicalPath: true,
      ...(Object.keys(originalTerminals).length ? { originalTerminals } : {}),
    } })
    stats.electricalTreeNativePathDemandCount++
    stats.electricalTreeVerifiedDemandCount++
  }
  stats.electricalTreeNativePathNetCount = nativeNets.size
  stats.electricalTreePhysicalEdgeCount = edges.length
  stats.electricalTreePhysicalBranchCount = connections.length - nativeDemands.size
  stats.electricalTreeCertifiedPadAttachmentCount = padAttachmentWitnesses.length
  const nodesWithPortPoints = [...outputPairs].map(([nodeId, pairs]) => {
    const node = sourceNodes.get(nodeId)
    if (!node) throw new Error(`Electrical tree lost node ${nodeId}`)
    return { ...node, portPointsInPairs: pairs, portPoints: pairs.flat() }
  })
  return { nodesWithPortPoints, connections, edges, stats, padAttachmentWitnesses }
}
