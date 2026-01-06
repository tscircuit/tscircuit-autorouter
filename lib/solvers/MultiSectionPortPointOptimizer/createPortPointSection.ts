import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "../../types"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
  ConnectionPathResult,
  PortPointCandidate,
} from "../PortPointPathingSolver/PortPointPathingSolver"

export interface PortPointSectionParams {
  centerOfSectionCapacityNodeId: CapacityMeshNodeId
  expansionDegrees: number
}

/**
 * A path segment that has been "cut" to fit within a section.
 * Contains the portion of the path that passes through section nodes,
 * plus entry/exit information for later reattachment.
 */
export interface SectionPath {
  /** The connection name this path belongs to */
  connectionName: string
  /** Root connection name if applicable */
  rootConnectionName?: string
  /** The cut path points (only the portion within the section) */
  points: Array<{
    x: number
    y: number
    z: number
    nodeId: CapacityMeshNodeId
    portPointId?: string
  }>
  /** Index in original path where this segment starts */
  originalStartIndex: number
  /** Index in original path where this segment ends */
  originalEndIndex: number
  /** True if path enters from outside the section */
  hasEntryFromOutside: boolean
  /** True if path exits to outside the section */
  hasExitToOutside: boolean
}

export interface PortPointSection {
  /** The center node ID for this section */
  centerNodeId: CapacityMeshNodeId
  /** How many hops from center this section covers */
  expansionDegrees: number
  /** All node IDs included in this section */
  nodeIds: Set<CapacityMeshNodeId>
  /** Input nodes filtered to just those in this section */
  inputNodes: InputNodeWithPortPoints[]
  /** Capacity mesh nodes filtered to just those in this section */
  capacityMeshNodes: CapacityMeshNode[]
  /** Edges that connect nodes within this section */
  internalEdges: CapacityMeshEdge[]
  /** Edges that connect section nodes to external nodes (boundary edges) */
  boundaryEdges: CapacityMeshEdge[]
  /** Paths that pass through this section, cut to fit within section bounds */
  sectionPaths: SectionPath[]
}

export interface CreatePortPointSectionInput {
  /** All input nodes with port points from PortPointPathingSolver */
  inputNodes: InputNodeWithPortPoints[]
  /** All capacity mesh nodes */
  capacityMeshNodes: CapacityMeshNode[]
  /** All capacity mesh edges */
  capacityMeshEdges: CapacityMeshEdge[]
  /** Map from node ID to input node for quick lookup */
  nodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>
  /** Connection path results from PortPointPathingSolver */
  connectionResults?: ConnectionPathResult[]
}

/**
 * Creates a section of the port point graph centered on a specific node,
 * expanding outward by a specified number of hops (edges).
 *
 * This is used by MultiSectionPortPointOptimizer to create subsets of the
 * full graph for local optimization.
 *
 * @param input - The full graph data from PortPointPathingSolver
 * @param params - Section parameters (center node, expansion degrees)
 * @returns A PortPointSection containing just the nodes and edges in the section
 */
export function createPortPointSection(
  input: CreatePortPointSectionInput,
  params: PortPointSectionParams,
): PortPointSection {
  const {
    inputNodes,
    capacityMeshNodes,
    capacityMeshEdges,
    connectionResults,
  } = input
  const { centerOfSectionCapacityNodeId, expansionDegrees } = params

  // Build adjacency map from edges
  const adjacencyMap = new Map<CapacityMeshNodeId, Set<CapacityMeshNodeId>>()
  for (const edge of capacityMeshEdges) {
    const [nodeId1, nodeId2] = edge.nodeIds
    if (!adjacencyMap.has(nodeId1)) {
      adjacencyMap.set(nodeId1, new Set())
    }
    if (!adjacencyMap.has(nodeId2)) {
      adjacencyMap.set(nodeId2, new Set())
    }
    adjacencyMap.get(nodeId1)!.add(nodeId2)
    adjacencyMap.get(nodeId2)!.add(nodeId1)
  }

  // BFS to find all nodes within expansionDegrees hops
  const sectionNodeIds = new Set<CapacityMeshNodeId>()
  const visited = new Set<CapacityMeshNodeId>()
  const queue: Array<{ nodeId: CapacityMeshNodeId; depth: number }> = []

  // Start from center node
  queue.push({ nodeId: centerOfSectionCapacityNodeId, depth: 0 })
  visited.add(centerOfSectionCapacityNodeId)

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!
    sectionNodeIds.add(nodeId)

    // If we haven't reached max depth, explore neighbors
    if (depth < expansionDegrees) {
      const neighbors = adjacencyMap.get(nodeId) ?? new Set()
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId)
          queue.push({ nodeId: neighborId, depth: depth + 1 })
        }
      }
    }
  }

  // Filter input nodes to those in section
  const sectionInputNodes = inputNodes.filter((node) =>
    sectionNodeIds.has(node.capacityMeshNodeId),
  )

  // Filter capacity mesh nodes to those in section
  const capacityMeshNodeMap = new Map(
    capacityMeshNodes.map((n) => [n.capacityMeshNodeId, n]),
  )
  const sectionCapacityMeshNodes = capacityMeshNodes.filter((node) =>
    sectionNodeIds.has(node.capacityMeshNodeId),
  )

  // Categorize edges as internal or boundary
  const internalEdges: CapacityMeshEdge[] = []
  const boundaryEdges: CapacityMeshEdge[] = []

  for (const edge of capacityMeshEdges) {
    const [nodeId1, nodeId2] = edge.nodeIds
    const node1InSection = sectionNodeIds.has(nodeId1)
    const node2InSection = sectionNodeIds.has(nodeId2)

    if (node1InSection && node2InSection) {
      internalEdges.push(edge)
    } else if (node1InSection || node2InSection) {
      boundaryEdges.push(edge)
    }
    // Edges where neither node is in section are ignored
  }

  // Filter port points to only include those connecting nodes within the section
  // or at the boundary (connecting section nodes to external nodes)
  const filteredInputNodes: InputNodeWithPortPoints[] = sectionInputNodes.map(
    (node) => {
      const filteredPortPoints = node.portPoints.filter((pp) => {
        const [connNodeId1, connNodeId2] = pp.connectionNodeIds
        // Keep port point if it connects two nodes in the section
        // OR if it connects a section node to an external node (boundary)
        const node1InSection = sectionNodeIds.has(connNodeId1)
        const node2InSection = sectionNodeIds.has(connNodeId2)
        return node1InSection || node2InSection
      })

      return {
        ...node,
        portPoints: filteredPortPoints,
      }
    },
  )

  // Cut paths to fit within the section
  const sectionPaths = cutPathsToSection(
    connectionResults ?? [],
    sectionNodeIds,
  )

  return {
    centerNodeId: centerOfSectionCapacityNodeId,
    expansionDegrees,
    nodeIds: sectionNodeIds,
    inputNodes: filteredInputNodes,
    capacityMeshNodes: sectionCapacityMeshNodes,
    internalEdges,
    boundaryEdges,
    sectionPaths,
  }
}

/**
 * Cut paths from connection results to only include portions within the section.
 * When a path enters and exits the section multiple times, all segments are merged
 * into a single SectionPath that spans from the first entry to the last exit.
 * This ensures the entire affected portion is re-routed as one unit.
 */
function cutPathsToSection(
  connectionResults: ConnectionPathResult[],
  sectionNodeIds: Set<CapacityMeshNodeId>,
): SectionPath[] {
  const sectionPaths: SectionPath[] = []

  for (const result of connectionResults) {
    if (!result.path || result.path.length === 0) continue

    const connectionName = result.connection.name
    const rootConnectionName = result.connection.rootConnectionName

    // Find all indices that are within the section
    const indicesInSection: number[] = []
    for (let i = 0; i < result.path.length; i++) {
      const candidate = result.path[i]
      const isInSection = sectionNodeIds.has(candidate.currentNodeId)
      if (isInSection) {
        indicesInSection.push(i)
      }
    }

    // If no points in section, skip this connection
    if (indicesInSection.length === 0) continue

    // Find the first and last indices that touch the section
    const firstIndexInSection = indicesInSection[0]
    const lastIndexInSection = indicesInSection[indicesInSection.length - 1]

    // Calculate entry/exit flags based on ACTUAL section boundaries
    // (before we potentially extend to include endpoints)
    const hasEntryFromOutside = firstIndexInSection > 0
    const hasExitToOutside = lastIndexInSection < result.path.length - 1

    // Determine the actual range to include in the merged segment
    let segmentStartIndex = firstIndexInSection
    let segmentEndIndex = lastIndexInSection

    // IMPORTANT: If the connection starts/ends OUTSIDE the section, but the adjacent
    // point is inside, we need to include the endpoint to preserve the connection
    // Check if index 0 (start endpoint) should be included
    if (firstIndexInSection > 0) {
      // There are points before the first section point
      // If index 0 is a connection endpoint, include it
      const firstNodeId = result.path[0].currentNodeId
      const isStartEndpoint =
        result.nodeIds[0] === firstNodeId || result.nodeIds[1] === firstNodeId
      if (isStartEndpoint) {
        segmentStartIndex = 0
      }
    }

    // Check if last index (end endpoint) should be included
    if (lastIndexInSection < result.path.length - 1) {
      // There are points after the last section point
      // If the last index is a connection endpoint, include it
      const lastPathIdx = result.path.length - 1
      const lastNodeId = result.path[lastPathIdx].currentNodeId
      const isEndEndpoint =
        result.nodeIds[0] === lastNodeId || result.nodeIds[1] === lastNodeId
      if (isEndEndpoint) {
        segmentEndIndex = lastPathIdx
      }
    }

    // Create a single merged section path that spans from first to last occurrence
    // This includes any points BETWEEN section nodes that might be outside the section
    const mergedSegment = result.path.slice(
      segmentStartIndex,
      segmentEndIndex + 1,
    )

    sectionPaths.push({
      connectionName,
      rootConnectionName,
      points: mergedSegment.map((c) => ({
        x: c.point.x,
        y: c.point.y,
        z: c.z,
        nodeId: c.currentNodeId,
        portPointId: c.portPoint?.portPointId,
      })),
      originalStartIndex: segmentStartIndex,
      originalEndIndex: segmentEndIndex,
      hasEntryFromOutside,
      hasExitToOutside,
    })
  }

  return sectionPaths
}
