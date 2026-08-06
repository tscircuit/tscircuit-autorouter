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

type SelectedRemovedPortPoint = RemovedPortPoint & {
  componentIds: [string, string]
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

const getRequiredTargetNodeIds = ({
  allowedNodeIds,
  capacityMeshNodes,
  connectivityMap,
  netId,
}: {
  allowedNodeIds: ReadonlySet<string>
  capacityMeshNodes: CapacityMeshNode[]
  connectivityMap: ConnectivityMap
  netId: string
}): Set<string> => {
  const targetNodeIds = new Set<string>()

  for (const node of capacityMeshNodes) {
    if (!allowedNodeIds.has(node.capacityMeshNodeId) || !node._containsTarget) {
      continue
    }
    const connectionIds = new Set([
      ...(node._connectedTo ?? []),
      ...(node._targetConnectionName ? [node._targetConnectionName] : []),
    ])
    const belongsToNet = [...connectionIds].some(
      (connectionId) =>
        connectivityMap.getNetConnectedToId(connectionId) === netId,
    )
    if (belongsToNet) targetNodeIds.add(node.capacityMeshNodeId)
  }

  return targetNodeIds.size >= 2
    ? targetNodeIds
    : new Set(allowedNodeIds)
}

const getSelectedRemovedPortPoints = ({
  allowedNodeIds,
  filteredSegments,
  removedPortPoints,
}: {
  allowedNodeIds: ReadonlySet<string>
  filteredSegments: SharedEdgeSegment[]
  removedPortPoints: RemovedPortPoint[]
}): {
  keptConnectivity: NodeDisjointSet
  selectedRemovedPortPoints: SelectedRemovedPortPoint[]
} => {
  const keptConnectivity = new NodeDisjointSet()

  for (const segment of filteredSegments) {
    const [firstNodeId, secondNodeId] = segment.nodeIds
    if (!allowedNodeIds.has(firstNodeId) || !allowedNodeIds.has(secondNodeId)) {
      continue
    }
    keptConnectivity.add(firstNodeId)
    keptConnectivity.add(secondNodeId)
    if (segment.portPoints.length > 0) {
      keptConnectivity.union(firstNodeId, secondNodeId)
    }
  }

  const restorationConnectivity = new NodeDisjointSet()
  const selectedRemovedPortPoints: SelectedRemovedPortPoint[] = []
  for (const { segment, portPoint } of removedPortPoints) {
    const [firstNodeId, secondNodeId] = segment.nodeIds
    if (!allowedNodeIds.has(firstNodeId) || !allowedNodeIds.has(secondNodeId)) {
      continue
    }
    const componentIds: [string, string] = [
      keptConnectivity.find(firstNodeId),
      keptConnectivity.find(secondNodeId),
    ]
    if (componentIds[0] === componentIds[1]) continue
    if (!restorationConnectivity.union(componentIds[0], componentIds[1])) {
      continue
    }
    selectedRemovedPortPoints.push({ segment, portPoint, componentIds })
  }

  return { keptConnectivity, selectedRemovedPortPoints }
}

const getTerminalSubtreePortPointIds = ({
  keptConnectivity,
  requiredNodeIds,
  selectedRemovedPortPoints,
}: {
  keptConnectivity: NodeDisjointSet
  requiredNodeIds: ReadonlySet<string>
  selectedRemovedPortPoints: SelectedRemovedPortPoint[]
}): Set<string> => {
  const requiredComponentIds = new Set(
    [...requiredNodeIds].map((nodeId) => keptConnectivity.find(nodeId)),
  )
  const edgeIndexesByComponentId = new Map<string, number[]>()

  for (const [edgeIndex, selectedPortPoint] of
    selectedRemovedPortPoints.entries()) {
    for (const componentId of selectedPortPoint.componentIds) {
      const edgeIndexes = edgeIndexesByComponentId.get(componentId) ?? []
      edgeIndexes.push(edgeIndex)
      edgeIndexesByComponentId.set(componentId, edgeIndexes)
    }
  }

  const activeEdges = selectedRemovedPortPoints.map(() => true)
  const degreeByComponentId = new Map(
    [...edgeIndexesByComponentId].map(([componentId, edgeIndexes]) => [
      componentId,
      edgeIndexes.length,
    ]),
  )
  const removableComponentIds = [...degreeByComponentId]
    .filter(
      ([componentId, degree]) =>
        degree <= 1 && !requiredComponentIds.has(componentId),
    )
    .map(([componentId]) => componentId)
  const removedComponentIds = new Set<string>()

  while (removableComponentIds.length > 0) {
    const componentId = removableComponentIds.pop()!
    if (removedComponentIds.has(componentId)) continue
    removedComponentIds.add(componentId)
    const edgeIndex = (edgeIndexesByComponentId.get(componentId) ?? []).find(
      (candidateEdgeIndex) => activeEdges[candidateEdgeIndex],
    )
    if (edgeIndex === undefined) continue

    activeEdges[edgeIndex] = false
    const selectedPortPoint = selectedRemovedPortPoints[edgeIndex]!
    const adjacentComponentId =
      selectedPortPoint.componentIds[0] === componentId
        ? selectedPortPoint.componentIds[1]
        : selectedPortPoint.componentIds[0]
    const adjacentDegree =
      (degreeByComponentId.get(adjacentComponentId) ?? 1) - 1
    degreeByComponentId.set(adjacentComponentId, adjacentDegree)
    if (
      adjacentDegree <= 1 &&
      !requiredComponentIds.has(adjacentComponentId)
    ) {
      removableComponentIds.push(adjacentComponentId)
    }
  }

  return new Set(
    selectedRemovedPortPoints.flatMap((selectedPortPoint, edgeIndex) =>
      activeEdges[edgeIndex]
        ? [selectedPortPoint.portPoint.segmentPortPointId]
        : [],
    ),
  )
}

const addRequiredPortsForNet = ({
  allowedNodeIds,
  filteredSegments,
  removedPortPoints,
  requiredNodeIds,
  restoredPortPointIds,
}: {
  allowedNodeIds: ReadonlySet<string>
  filteredSegments: SharedEdgeSegment[]
  removedPortPoints: RemovedPortPoint[]
  requiredNodeIds: ReadonlySet<string>
  restoredPortPointIds: Set<string>
}): void => {
  const { keptConnectivity, selectedRemovedPortPoints } =
    getSelectedRemovedPortPoints({
      allowedNodeIds,
      filteredSegments,
      removedPortPoints,
    })
  const terminalSubtreePortPointIds = getTerminalSubtreePortPointIds({
    keptConnectivity,
    requiredNodeIds,
    selectedRemovedPortPoints,
  })
  for (const portPointId of terminalSubtreePortPointIds) {
    restoredPortPointIds.add(portPointId)
  }
}

/**
 * Restores the part of a minimum spanning forest needed to connect each net's
 * target regions. The forest only uses regions that the net may legally enter.
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
    const allowedNodeIds = getAllowedNodeIds({
      capacityMeshNodes,
      connectivityMap,
      netId,
    })
    addRequiredPortsForNet({
      allowedNodeIds,
      requiredNodeIds: getRequiredTargetNodeIds({
        allowedNodeIds,
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
