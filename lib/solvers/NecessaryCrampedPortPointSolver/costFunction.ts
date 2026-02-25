import { DepthLimitedBfsCandidate } from "./types"

export const costFunction = (candidate: DepthLimitedBfsCandidate): number => {
  return candidate.depth + candidate.countOfCrampedPortPointsInPath * 1000
}
