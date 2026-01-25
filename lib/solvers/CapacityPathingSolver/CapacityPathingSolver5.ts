import type { CapacityMeshNode } from "lib/types"
import { CapacityPathingSolver, type Candidate } from "./CapacityPathingSolver"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"

export class CapacityPathingSolver5 extends CapacityPathingSolver {
  override getSolverName(): string {
    return "CapacityPathingSolver5"
  }

  NEGATIVE_CAPACITY_PENALTY_FACTOR = 1
  REDUCED_CAPACITY_PENALTY_FACTOR = 1

  constructor(...args: ConstructorParameters<typeof CapacityPathingSolver>) {
    super(...args)
    this.GREEDY_MULTIPLIER = 2.5
  }

  get maxCapacityFactor() {
    return this.hyperParameters.MAX_CAPACITY_FACTOR ?? 1
  }

  getTotalCapacity(node: CapacityMeshNode): number {
    return getTunedTotalCapacity1(node, this.maxCapacityFactor)
  }

  /**
   * Penalty you pay for using this node
   */
  getNodeCapacityPenalty(node: CapacityMeshNode): number {
    // return 0.05

    const MAX_PENALTY = node.width + node.height
    const MIN_PENALTY = 0.05

    const START_PENALIZING_CAPACITY_WHEN_IT_DROPS_BELOW = 2

    const totalCapacity = this.getTotalCapacity(node)
    const usedCapacity =
      this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
    const remainingCapacity = totalCapacity - usedCapacity

    if (remainingCapacity > START_PENALIZING_CAPACITY_WHEN_IT_DROPS_BELOW) {
      return MIN_PENALTY
    }

    const penalty =
      (MAX_PENALTY - MIN_PENALTY) *
        Math.max(
          1,
          (START_PENALIZING_CAPACITY_WHEN_IT_DROPS_BELOW - remainingCapacity) /
            (MAX_PENALTY - MIN_PENALTY),
        ) +
      MIN_PENALTY

    return penalty
    // const penalty =
    //   (MAX_PENALTY - MIN_PENALTY) *
    //   (remainingCapacity / START_PENALIZING_CAPACITY_WHEN_IT_DROPS_BELOW)

    // return penalty
    // if (node.availableZ.length === 1) {
    //   return 0
    // }

    // const dist = this.activeCandidateStraightLineDistance!

    // if (remainingCapacity <= 0) {
    //   //  | Total Cap | Remaining Cap | Remaining Cap Ratio | PenaltySLD    |
    //   //  | 1         | 0             | (-( 0) + 1) / 1     | 1^2  = 1      |
    //   //  | 1         | -1            | (-(-1) + 1) / 1     | 2^2  = 4      |
    //   //  | 1         | -2            | (-(-2) + 1) / 1     | 3^2  = 9      |
    //   //  | 2         | 0             | (-( 0) + 1) / 2     | 0.5^2 = 0.25  |
    //   //  | 2         | -1            | (-(-1) + 1) / 2     | 1^2 = 1       |
    //   //  | 2         | -2            | (-(-2) + 1) / 2     | 2^2 = 4       |
    //   //  | 2         | -3            | (-(-3) + 1) / 2     | 3^2 = 9       |
    //   //  | 3         | 0             | (-( 0) + 1) / 3     | 0.333^2= 0.111|
    //   //  | 3         | -1            | (-(-1) + 1) / 3     | 0.666^2= 0.444|
    //   //  | 3         | -2            | (-(-2) + 1) / 3     | 1^2 = 1       |
    //   //  | 3         | -3            | (-(-3) + 1) / 3     | 2^2 = 4       |
    //   const penalty =
    //     ((-remainingCapacity + 1) / totalCapacity) *
    //     dist *
    //     (this.NEGATIVE_CAPACITY_PENALTY_FACTOR / 4)

    //   return penalty ** 2
    // }

    // This node still has capacity, but penalize as we reduce the capacity
    // return (
    //   ((1 / remainingCapacity) * dist * this.REDUCED_CAPACITY_PENALTY_FACTOR) /
    //   8
    // )
  }

  /**
   * We're rewarding travel into big nodes.
   *
   * To minimize shortest path, you'd want to comment this out.
   */
  getDistanceBetweenNodes(A: CapacityMeshNode, B: CapacityMeshNode) {
    const dx = A.center.x - B.center.x
    const dy = A.center.y - B.center.y

    return Math.sqrt(dx ** 2 + dy ** 2)

    // REWARD BIG NODE TRAVEL
    // const szx = Math.max(A.width, B.width)
    // const szy = Math.max(A.height, B.height)

    // const dist = Math.sqrt(dx ** 2 + dy ** 2) / (szx * szy)

    // return dist
  }

  computeG(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    return (
      prevCandidate.g +
      this.getDistanceBetweenNodes(prevCandidate.node, node) +
      this.getNodeCapacityPenalty(node)
    )
  }

  computeH(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    return (
      this.getDistanceBetweenNodes(node, endGoal) +
      this.getNodeCapacityPenalty(node)
    )
  }
}
