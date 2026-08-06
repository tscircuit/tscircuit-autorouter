import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

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

const compareRemovedPortPoints = (
  left: RemovedPortPoint,
  right: RemovedPortPoint,
): number =>
  left.portPoint.distToCentermostPortOnZ -
    right.portPoint.distToCentermostPortOnZ ||
  left.portPoint.segmentPortPointId.localeCompare(
    right.portPoint.segmentPortPointId,
  )

/**
 * Restores the smallest spanning set of removed ports needed to retain the
 * original region graph's connectivity.
 */
export const restoreCrampedPortPointConnectivity = ({
  originalSegments,
  filteredSegments,
}: {
  originalSegments: SharedEdgeSegment[]
  filteredSegments: SharedEdgeSegment[]
}): SharedEdgeSegment[] => {
  const filteredSegmentById = new Map(
    filteredSegments.map((segment) => [segment.edgeId, segment]),
  )
  const keptPortPointIds = new Set(
    filteredSegments.flatMap((segment) =>
      segment.portPoints.map((portPoint) => portPoint.segmentPortPointId),
    ),
  )
  const connectivity = new NodeDisjointSet()

  for (const segment of filteredSegments) {
    for (const nodeId of segment.nodeIds) connectivity.add(nodeId)
    if (segment.portPoints.length > 0) {
      connectivity.union(segment.nodeIds[0], segment.nodeIds[1])
    }
  }

  const removedPortPoints = originalSegments
    .flatMap((segment) =>
      segment.portPoints.map((portPoint) => ({ segment, portPoint })),
    )
    .filter(
      ({ portPoint }) =>
        !keptPortPointIds.has(portPoint.segmentPortPointId),
    )
    .sort(compareRemovedPortPoints)
  const restoredPortPointsByEdgeId = new Map<string, SegmentPortPoint[]>()

  for (const { segment, portPoint } of removedPortPoints) {
    if (!connectivity.union(segment.nodeIds[0], segment.nodeIds[1])) continue
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
