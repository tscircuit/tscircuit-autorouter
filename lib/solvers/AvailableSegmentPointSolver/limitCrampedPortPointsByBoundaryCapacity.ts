import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "./AvailableSegmentPointSolver"

const BOUNDARY_EPSILON = 1e-6

type BoundarySide = "bottom" | "left" | "right" | "top"
type BoundaryGroupKey = `${string}:${BoundarySide}:z${number}`

type BoundaryCandidate = {
  intervalEnd: number
  intervalStart: number
  portPoint: SegmentPortPoint
  position: number
}

const getBoundarySide = ({
  ownerNode,
  segment,
}: {
  ownerNode: CapacityMeshNode
  segment: SharedEdgeSegment
}): BoundarySide => {
  const isVertical =
    Math.abs(segment.end.x - segment.start.x) <=
    Math.abs(segment.end.y - segment.start.y)
  if (isVertical) {
    return segment.start.x < ownerNode.center.x ? "left" : "right"
  }
  return segment.start.y < ownerNode.center.y ? "bottom" : "top"
}

const getBoundaryOwner = ({
  nodeById,
  segment,
}: {
  nodeById: ReadonlyMap<CapacityMeshNodeId, CapacityMeshNode>
  segment: SharedEdgeSegment
}): CapacityMeshNode => {
  const firstNode = nodeById.get(segment.nodeIds[0])!
  const secondNode = nodeById.get(segment.nodeIds[1])!
  const isVertical =
    Math.abs(segment.end.x - segment.start.x) <=
    Math.abs(segment.end.y - segment.start.y)
  const firstBoundaryLength = isVertical ? firstNode.height : firstNode.width
  const secondBoundaryLength = isVertical ? secondNode.height : secondNode.width
  if (
    Math.abs(firstBoundaryLength - secondBoundaryLength) > BOUNDARY_EPSILON
  ) {
    return firstBoundaryLength > secondBoundaryLength ? firstNode : secondNode
  }

  const firstArea = firstNode.width * firstNode.height
  const secondArea = secondNode.width * secondNode.height
  if (Math.abs(firstArea - secondArea) > BOUNDARY_EPSILON) {
    return firstArea > secondArea ? firstNode : secondNode
  }
  return firstNode.capacityMeshNodeId.localeCompare(
    secondNode.capacityMeshNodeId,
  ) <= 0
    ? firstNode
    : secondNode
}

const getBoundaryCandidate = ({
  portPoint,
  segment,
}: {
  portPoint: SegmentPortPoint
  segment: SharedEdgeSegment
}): BoundaryCandidate => {
  const isVertical =
    Math.abs(segment.end.x - segment.start.x) <=
    Math.abs(segment.end.y - segment.start.y)
  const firstPosition = isVertical ? segment.start.y : segment.start.x
  const secondPosition = isVertical ? segment.end.y : segment.end.x
  return {
    intervalStart: Math.min(firstPosition, secondPosition),
    intervalEnd: Math.max(firstPosition, secondPosition),
    position: isVertical ? portPoint.y : portPoint.x,
    portPoint,
  }
}

const selectRunPortPoints = ({
  candidates,
  minPortSpacing,
  physicallySupportedPortPointIds,
  fallbackPortPointIds,
}: {
  candidates: BoundaryCandidate[]
  minPortSpacing: number
  physicallySupportedPortPointIds: Set<string>
  fallbackPortPointIds: Set<string>
}): void => {
  const sortedCandidates = [...candidates].sort(
    (left, right) =>
      left.position - right.position ||
      left.portPoint.segmentPortPointId.localeCompare(
        right.portPoint.segmentPortPointId,
      ),
  )
  const runStart = Math.min(
    ...sortedCandidates.map((candidate) => candidate.intervalStart),
  )
  const runEnd = Math.max(
    ...sortedCandidates.map((candidate) => candidate.intervalEnd),
  )
  const edgeMargin = (minPortSpacing * 3) / 4
  const minimumPosition = runStart + edgeMargin
  const maximumPosition = runEnd - edgeMargin
  let lastPosition = Number.NEGATIVE_INFINITY

  if (minimumPosition <= maximumPosition + BOUNDARY_EPSILON) {
    for (const candidate of sortedCandidates) {
      if (
        candidate.position < minimumPosition - BOUNDARY_EPSILON ||
        candidate.position > maximumPosition + BOUNDARY_EPSILON ||
        candidate.position - lastPosition < minPortSpacing - BOUNDARY_EPSILON
      ) {
        continue
      }
      physicallySupportedPortPointIds.add(
        candidate.portPoint.segmentPortPointId,
      )
      lastPosition = candidate.position
    }
  }

  if (
    sortedCandidates.some((candidate) =>
      physicallySupportedPortPointIds.has(
        candidate.portPoint.segmentPortPointId,
      ),
    )
  ) {
    return
  }

  const runCenter = (runStart + runEnd) / 2
  const fallbackCandidate = sortedCandidates.reduce((closest, candidate) =>
    Math.abs(candidate.position - runCenter) <
    Math.abs(closest.position - runCenter)
      ? candidate
      : closest,
  )
  fallbackPortPointIds.add(fallbackCandidate.portPoint.segmentPortPointId)
}

/**
 * Treats adjacent short edge fragments as one physical boundary when deciding
 * how many cramped fallback ports can fit.
 */
export const limitCrampedPortPointsByBoundaryCapacity = ({
  minPortSpacing,
  nodeById,
  sharedEdgeSegments,
}: {
  minPortSpacing: number
  nodeById: ReadonlyMap<CapacityMeshNodeId, CapacityMeshNode>
  sharedEdgeSegments: SharedEdgeSegment[]
}): SharedEdgeSegment[] => {
  const candidatesByBoundary = new Map<
    BoundaryGroupKey,
    BoundaryCandidate[]
  >()
  const protectedPortPointIds = new Set<string>()

  for (const segment of sharedEdgeSegments) {
    const ownerNode = getBoundaryOwner({ nodeById, segment })
    const side = getBoundarySide({ ownerNode, segment })
    const preservesSpecialPassage = segment.nodeIds.some((nodeId) => {
      const node = nodeById.get(nodeId)
      return Boolean(node?._isNarrowQfpPadGap || node?._offBoardConnectionId)
    })
    for (const portPoint of segment.portPoints) {
      if (!portPoint.cramped) continue
      if (
        preservesSpecialPassage ||
        portPoint._preloadedTracePortAssignments?.length
      ) {
        protectedPortPointIds.add(portPoint.segmentPortPointId)
        continue
      }
      const z = portPoint.availableZ[0]!
      const key: BoundaryGroupKey = `${ownerNode.capacityMeshNodeId}:${side}:z${z}`
      const candidates = candidatesByBoundary.get(key) ?? []
      candidates.push(getBoundaryCandidate({ portPoint, segment }))
      candidatesByBoundary.set(key, candidates)
    }
  }

  const physicallySupportedPortPointIds = new Set<string>()
  const fallbackPortPointIds = new Set<string>()
  for (const candidates of candidatesByBoundary.values()) {
    const sortedCandidates = [...candidates].sort(
      (left, right) => left.intervalStart - right.intervalStart,
    )
    let currentRun: BoundaryCandidate[] = []
    let currentRunEnd = Number.NEGATIVE_INFINITY
    for (const candidate of sortedCandidates) {
      if (
        currentRun.length > 0 &&
        candidate.intervalStart > currentRunEnd + BOUNDARY_EPSILON
      ) {
        selectRunPortPoints({
          candidates: currentRun,
          minPortSpacing,
          physicallySupportedPortPointIds,
          fallbackPortPointIds,
        })
        currentRun = []
        currentRunEnd = Number.NEGATIVE_INFINITY
      }
      currentRun.push(candidate)
      currentRunEnd = Math.max(currentRunEnd, candidate.intervalEnd)
    }
    if (currentRun.length > 0) {
      selectRunPortPoints({
        candidates: currentRun,
        minPortSpacing,
        physicallySupportedPortPointIds,
        fallbackPortPointIds,
      })
    }
  }

  return sharedEdgeSegments.map((segment) => ({
    ...segment,
    portPoints: segment.portPoints.flatMap((portPoint) => {
      if (!portPoint.cramped) return [portPoint]
      if (protectedPortPointIds.has(portPoint.segmentPortPointId)) {
        return [portPoint]
      }
      if (physicallySupportedPortPointIds.has(portPoint.segmentPortPointId)) {
        return [{ ...portPoint, cramped: false }]
      }
      return fallbackPortPointIds.has(portPoint.segmentPortPointId)
        ? [portPoint]
        : []
    }),
  }))
}
