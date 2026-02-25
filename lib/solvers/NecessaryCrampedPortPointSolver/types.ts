import { CapacityMeshNode } from "lib/types"
import {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

export type NecessaryCrampedPortPointSolverInput = {
  segmentPortPoints: SharedEdgeSegment[]
  capacityMeshNodes: CapacityMeshNode[]
}

export type DepthLimitedBfsCandidate = {
  port: SegmentPortPoint
  depth: number
  parent: DepthLimitedBfsCandidate | null
  countOfCrampedPortPointsInPath: number
}
