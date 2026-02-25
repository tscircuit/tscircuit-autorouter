import { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

export type ExploredPortPoint = {
  port: SegmentPortPoint
  depth: number
  parent: ExploredPortPoint | null
  countOfCrampedPortPointsInPath: number
}
