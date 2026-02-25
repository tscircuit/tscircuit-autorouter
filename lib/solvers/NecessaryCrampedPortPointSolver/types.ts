import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

export type NecessaryCrampedPortPointSolverInput = {
  segmentPortPoints: SegmentPortPoint[]
  capacityMeshNodes: CapacityMeshNode[]
}

export type DepthTestInput = {
  target: CapacityMeshNode
  mapOfCapacityMeshNodeIdToSegmentPortPoints: Map<
    CapacityMeshNodeId,
    SegmentPortPoint[]
  >
  mapOfCapacityMeshNodeIdToRef: Map<CapacityMeshNodeId, CapacityMeshNode>
  depthLimit: number
  shouldIgnoreCrampedPortPoints: boolean
}

export type DepthLimitedBfsCandidate = {
  port: SegmentPortPoint
  depth: number
  parent: DepthLimitedBfsCandidate | null
  countOfCrampedPortPointsInPath: number
}

export type IsAllCandidatesBlockedByObstaclesInput = {
  candidates: DepthLimitedBfsCandidate[]
  mapOfCapacityMeshNodeIdToRef: Map<CapacityMeshNodeId, CapacityMeshNode>
}
