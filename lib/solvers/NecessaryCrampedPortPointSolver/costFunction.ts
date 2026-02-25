import { ExploredPortPoint } from "./types"

export const costFunction = (candidate: ExploredPortPoint): number => {
  return candidate.depth + candidate.countOfCrampedPortPointsInPath * 1000
}
