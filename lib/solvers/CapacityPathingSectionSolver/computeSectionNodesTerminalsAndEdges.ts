import {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types"
import { ConnectionPathWithNodes } from "../CapacityPathingSolver/CapacityPathingSolver"

export interface SectionConnectionTerminal {
  connectionName: string
  startNodeId: CapacityMeshNodeId
  endNodeId: CapacityMeshNodeId
  path?: CapacityMeshNode[] // To store the result for this connection
}
export interface CapacityPathingSection {
  centerNodeId: string
  sectionConnectionTerminals: SectionConnectionTerminal[]
  sectionNodes: CapacityMeshNode[]
  sectionEdges: CapacityMeshEdge[]
}

export const computeSectionNodesTerminalsAndEdges = (opts: {
  centerNodeId: string
  connectionsWithNodes: Array<ConnectionPathWithNodes>
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>
  edges: CapacityMeshEdge[]
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  expansionDegrees: number
}): CapacityPathingSection => {
  const {
    centerNodeId,
    connectionsWithNodes,
    nodeMap,
    edges,
    nodeEdgeMap,
    expansionDegrees,
  } = opts

  const sectionNodeIds = new Set<CapacityMeshNodeId>()
  const queue: Array<{ nodeId: CapacityMeshNodeId; depth: number }> = [
    { nodeId: centerNodeId, depth: 0 },
  ]
  sectionNodeIds.add(centerNodeId)

  let head = 0
  while (head < queue.length) {
    const { nodeId, depth } = queue[head++]

    if (depth >= expansionDegrees) continue

    const neighbors =
      nodeEdgeMap
        .get(nodeId)
        ?.flatMap((edge) => edge.nodeIds.filter((id) => id !== nodeId)) ?? []

    for (const neighborId of neighbors) {
      if (!sectionNodeIds.has(neighborId)) {
        sectionNodeIds.add(neighborId)
        queue.push({ nodeId: neighborId, depth: depth + 1 })
      }
    }
  }

  const sectionNodes = Array.from(sectionNodeIds).map((id) => nodeMap.get(id)!)

  // Compute section edges (edges where both nodes are in the section)
  const sectionEdges = edges.filter((edge) => {
    const [nodeIdA, nodeIdB] = edge.nodeIds
    return sectionNodeIds.has(nodeIdA) && sectionNodeIds.has(nodeIdB)
  })

  // Compute terminals
  const sectionConnectionTerminals = []
  for (const conn of connectionsWithNodes) {
    if (!conn.path) continue

    let startNodeId: CapacityMeshNodeId | null = null
    let endNodeId: CapacityMeshNodeId | null = null

    // Find the first node in the path that is within the section
    for (const node of conn.path) {
      if (sectionNodeIds.has(node.capacityMeshNodeId)) {
        startNodeId = node.capacityMeshNodeId
        break
      }
    }

    // Find the last node in the path that is within the section
    for (let i = conn.path.length - 1; i >= 0; i--) {
      const node = conn.path[i]
      if (sectionNodeIds.has(node.capacityMeshNodeId)) {
        endNodeId = node.capacityMeshNodeId
        break
      }
    }

    if (startNodeId && endNodeId) {
      sectionConnectionTerminals.push({
        connectionName: conn.connection.name,
        startNodeId,
        endNodeId,
      })
    }
  }
  return {
    sectionConnectionTerminals,
    sectionNodes,
    sectionEdges,
    centerNodeId,
  }
}
