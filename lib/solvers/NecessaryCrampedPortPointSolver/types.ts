import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

export type DepthLimitedBfsCandidate = {
  port: SegmentPortPoint
  depth: number
  parent: DepthLimitedBfsCandidate | null
  countOfCrampedPortPointsInPath: number
}
