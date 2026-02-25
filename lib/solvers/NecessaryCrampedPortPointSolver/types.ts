import { CapacityMeshNode } from "lib/types"
import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

export type NecessaryCrampedPortPointSolverInput = {
  segmentPortPoints: SegmentPortPoint[]
  capacityMeshNodes: CapacityMeshNode[]
}

export type DepthLimitedBfsCandidate = {
  port: SegmentPortPoint
  depth: number
  parent: DepthLimitedBfsCandidate | null
  countOfCrampedPortPointsInPath: number
}
