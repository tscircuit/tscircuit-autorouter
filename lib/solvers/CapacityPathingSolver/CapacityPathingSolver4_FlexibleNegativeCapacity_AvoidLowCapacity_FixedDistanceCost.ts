import type { CapacityMeshNode } from "lib/types"
import { CapacityPathingSolver, type Candidate } from "./CapacityPathingSolver"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"

export class CapacityPathingSolver4_FlexibleNegativeCapacity extends CapacityPathingSolver {
  override getSolverName(): string {
    return "CapacityPathingSolver4_FlexibleNegativeCapacity"
  }

  NEGATIVE_CAPACITY_PENALTY_FACTOR = 1
  REDUCED_CAPACITY_PENALTY_FACTOR = 1

  get maxCapacityFactor() {
    return this.hyperParameters.MAX_CAPACITY_FACTOR ?? 1
  }

  /**
   * In the FlexibleNegativeCapacity mode, we allow negative capacity
   */
  doesNodeHaveCapacityForTrace(node: CapacityMeshNode): boolean {
    return true
  }

  getTotalCapacity(node: CapacityMeshNode): number {
    return getTunedTotalCapacity1(node, this.maxCapacityFactor)
  }

  /**
   * Penalty you pay for using this node
   */
  getNodeCapacityPenalty(node: CapacityMeshNode): number {
    const totalCapacity = this.getTotalCapacity(node)
    const usedCapacity =
      this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
    const remainingCapacity = totalCapacity - usedCapacity

    const dist = this.activeCandidateStraightLineDistance!

    if (remainingCapacity <= 0) {
      //  | Total Cap | Remaining Cap | Remaining Cap Ratio | PenaltySLD    |
      //  | 1         | 0             | (-( 0) + 1) / 1     | 1^2  = 1      |
      //  | 1         | -1            | (-(-1) + 1) / 1     | 2^2  = 4      |
      //  | 1         | -2            | (-(-2) + 1) / 1     | 3^2  = 9      |
      //  | 2         | 0             | (-( 0) + 1) / 2     | 0.5^2 = 0.25  |
      //  | 2         | -1            | (-(-1) + 1) / 2     | 1^2 = 1       |
      //  | 2         | -2            | (-(-2) + 1) / 2     | 2^2 = 4       |
      //  | 2         | -3            | (-(-3) + 1) / 2     | 3^2 = 9       |
      //  | 3         | 0             | (-( 0) + 1) / 3     | 0.333^2= 0.111|
      //  | 3         | -1            | (-(-1) + 1) / 3     | 0.666^2= 0.444|
      //  | 3         | -2            | (-(-2) + 1) / 3     | 1^2 = 1       |
      //  | 3         | -3            | (-(-3) + 1) / 3     | 2^2 = 4       |
      const penalty =
        ((-remainingCapacity + 1) / totalCapacity) *
        dist *
        (this.NEGATIVE_CAPACITY_PENALTY_FACTOR / 4)

      return penalty ** 2
    }

    // This node still has capacity, but penalize as we reduce the capacity
    return (
      ((1 / remainingCapacity) * dist * this.REDUCED_CAPACITY_PENALTY_FACTOR) /
      8
    )
  }

  /**
   * We're rewarding travel into big nodes.
   *
   * To minimize shortest path, you'd want to comment this out.
   */
  getDistanceBetweenNodes(A: CapacityMeshNode, B: CapacityMeshNode) {
    const dx = A.center.x - B.center.x
    const dy = A.center.y - B.center.y

    const szx = Math.max(A.width, B.width)
    const szy = Math.max(A.height, B.height)

    const dist = Math.sqrt(dx ** 2 + dy ** 2) / (szx * szy)

    return dist
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
