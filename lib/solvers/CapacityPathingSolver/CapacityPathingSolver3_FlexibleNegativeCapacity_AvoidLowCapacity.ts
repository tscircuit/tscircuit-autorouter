import type { CapacityMeshNode } from "lib/types"
import { CapacityPathingSolver, type Candidate } from "./CapacityPathingSolver"

export class CapacityPathingSolver3_FlexibleNegativeCapacity_AvoidLowCapacity extends CapacityPathingSolver {
  override getSolverName(): string {
    return "CapacityPathingSolver3_FlexibleNegativeCapacity_AvoidLowCapacity"
  }

  /**
   * In the FlexibleNegativeCapacity mode, we allow negative capacity
   */
  doesNodeHaveCapacityForTrace(node: CapacityMeshNode): boolean {
    return true
  }

  computeG(
    prevCandidate: Candidate,
    node: CapacityMeshNode,
    endGoal: CapacityMeshNode,
  ) {
    const nodeCapacity = this.getTotalCapacity(node)
    const distanceToPrevNode = Math.sqrt(
      (node.center.x - prevCandidate.node.center.x) ** 2 +
        (node.center.y - prevCandidate.node.center.y) ** 2,
    )

    const distMultiplier =
      1 / (nodeCapacity > 0 ? nodeCapacity : 0.1 ** nodeCapacity)

    return prevCandidate.g + distanceToPrevNode * distMultiplier
  }
}
