import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  CapacityMeshNode,
  SimpleRouteConnection,
} from "lib/types"

class NodeDisjointSet {
  private readonly parent = new Map<string, string>()

  add(nodeId: string): void {
    if (!this.parent.has(nodeId)) this.parent.set(nodeId, nodeId)
  }

  find(nodeId: string): string {
    this.add(nodeId)
    const parentId = this.parent.get(nodeId)!
    if (parentId === nodeId) return nodeId
    const rootId = this.find(parentId)
    this.parent.set(nodeId, rootId)
    return rootId
  }

  union(firstNodeId: string, secondNodeId: string): boolean {
    const firstRootId = this.find(firstNodeId)
    const secondRootId = this.find(secondNodeId)
    if (firstRootId === secondRootId) return false
    this.parent.set(secondRootId, firstRootId)
    return true
  }
}

type RemovedPortPoint = {
  segment: SharedEdgeSegment
  portPoint: SegmentPortPoint
}

type ConnectivityInput = {
  capacityMeshNodes: CapacityMeshNode[]
  connectivityMap: ConnectivityMap
  filteredSegments: SharedEdgeSegment[]
  originalSegments: SharedEdgeSegment[]
  simpleRouteJsonConnections: SimpleRouteConnection[]
}

const compareRemovedPortPoints = (
  left: RemovedPortPoint,
  right: RemovedPortPoint,
): number =>
  left.portPoint.distToCentermostPortOnZ -
    right.portPoint.distToCentermostPortOnZ ||
  left.portPoint.segmentPortPointId.localeCompare(
    right.portPoint.segmentPortPointId,
  )

const getNetId = ({
  connectionId,
  connectivityMap,
}: {
  connectionId: string
  connectivityMap: ConnectivityMap
}): string => {
  const netId = connectivityMap.getNetConnectedToId(connectionId)
  if (!netId) {
    throw new Error(`Could not resolve net ID for connection "${connectionId}"`)
  }
  return netId
}

const getAllowedNodeIds = ({
  capacityMeshNodes,
  connectivityMap,
  netId,
}: {
  capacityMeshNodes: CapacityMeshNode[]
  connectivityMap: ConnectivityMap
  netId: string
}): Set<string> =>
  new Set(
    capacityMeshNodes.flatMap((node) => {
      if (!node._connectedTo?.length) return [node.capacityMeshNodeId]
      const reservedNetIds = node._connectedTo.map((connectionId) =>
        getNetId({ connectionId, connectivityMap }),
      )
      return reservedNetIds.includes(netId) ? [node.capacityMeshNodeId] : []
    }),
  )

const addRequiredPortsForNet = ({
  allowedNodeIds,
  filteredSegments,
  removedPortPoints,
  restoredPortPointIds,
}: {
  allowedNodeIds: Set<string>
  filteredSegments: SharedEdgeSegment[]
  removedPortPoints: RemovedPortPoint[]
  restoredPortPointIds: Set<string>
}): void => {
  const connectivity = new NodeDisjointSet()

  for (const segment of filteredSegments) {
    const [firstNodeId, secondNodeId] = segment.nodeIds
    if (!allowedNodeIds.has(firstNodeId) || !allowedNodeIds.has(secondNodeId)) {
      continue
    }
    connectivity.add(firstNodeId)
    connectivity.add(secondNodeId)
    if (segment.portPoints.length > 0) {
      connectivity.union(firstNodeId, secondNodeId)
    }
  }

  for (const { segment, portPoint } of removedPortPoints) {
    const [firstNodeId, secondNodeId] = segment.nodeIds
    if (!allowedNodeIds.has(firstNodeId) || !allowedNodeIds.has(secondNodeId)) {
      continue
    }
    if (!connectivity.union(firstNodeId, secondNodeId)) continue
    restoredPortPointIds.add(portPoint.segmentPortPointId)
  }
}

/**
 * Restores a minimum spanning set of removed ports for each net. A net's
 * spanning set only uses regions that the net may legally enter, so pruning
 * cannot disconnect paths that existed before filtering.
 */
export const restoreCrampedPortPointConnectivity = ({
  capacityMeshNodes,
  connectivityMap,
  filteredSegments,
  originalSegments,
  simpleRouteJsonConnections,
}: ConnectivityInput): SharedEdgeSegment[] => {
  const filteredSegmentById = new Map(
    filteredSegments.map((segment) => [segment.edgeId, segment]),
  )
  const keptPortPointIds = new Set(
    filteredSegments.flatMap((segment) =>
      segment.portPoints.map((portPoint) => portPoint.segmentPortPointId),
    ),
  )
  const removedPortPoints = originalSegments
    .flatMap((segment) =>
      segment.portPoints.map((portPoint) => ({ segment, portPoint })),
    )
    .filter(
      ({ portPoint }) =>
        !keptPortPointIds.has(portPoint.segmentPortPointId),
    )
    .sort(compareRemovedPortPoints)
  const netIds = new Set(
    simpleRouteJsonConnections.map((connection) =>
      getNetId({ connectionId: connection.name, connectivityMap }),
    ),
  )
  const restoredPortPointIds = new Set<string>()

  for (const netId of netIds) {
    addRequiredPortsForNet({
      allowedNodeIds: getAllowedNodeIds({
        capacityMeshNodes,
        connectivityMap,
        netId,
      }),
      filteredSegments,
      removedPortPoints,
      restoredPortPointIds,
    })
  }

  const restoredPortPointsByEdgeId = new Map<string, SegmentPortPoint[]>()

  for (const { segment, portPoint } of removedPortPoints) {
    if (!restoredPortPointIds.has(portPoint.segmentPortPointId)) continue
    const restoredPortPoints =
      restoredPortPointsByEdgeId.get(segment.edgeId) ?? []
    restoredPortPoints.push(portPoint)
    restoredPortPointsByEdgeId.set(segment.edgeId, restoredPortPoints)
  }

  return originalSegments.map((originalSegment) => {
    const filteredSegment = filteredSegmentById.get(originalSegment.edgeId)
    const restoredPortPoints =
      restoredPortPointsByEdgeId.get(originalSegment.edgeId) ?? []
    return {
      ...(filteredSegment ?? originalSegment),
      portPoints: [
        ...(filteredSegment?.portPoints ?? []),
        ...restoredPortPoints,
      ],
    }
  })
}
