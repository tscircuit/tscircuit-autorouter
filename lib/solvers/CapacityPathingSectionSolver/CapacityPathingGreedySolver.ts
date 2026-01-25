import { CapacityMeshNode } from "lib/types"
import { CapacityPathingSolver5 } from "../CapacityPathingSolver/CapacityPathingSolver5"

export class CapacityPathingGreedySolver extends CapacityPathingSolver5 {
  override getSolverName(): string {
    return "CapacityPathingGreedySolver"
  }

  doesNodeHaveCapacityForTrace(
    node: CapacityMeshNode,
    prevNode: CapacityMeshNode,
  ): boolean {
    return true
  }

  getNodeCapacityPenalty(node: CapacityMeshNode): number {
    /**
     * Roughly, -1 remaining capacity is penalized to this much distance
     */
    const mmPenaltyFactor = 2
    const MIN_PENALTY = 0.05
    const totalCapacity = this.getTotalCapacity(node)
    const usedCapacity =
      this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0
    const remainingCapacity = totalCapacity - usedCapacity - 1
    if (remainingCapacity > 0) {
      return 0
    }
    // const probabilityOfFailure = calculateNodeProbabilityOfFailure(
    //   usedCapacity,
    //   totalCapacity,
    //   node.availableZ.length,
    // )
    let singleLayerUsagePenaltyFactor = 1
    if (node.availableZ.length === 1) {
      singleLayerUsagePenaltyFactor = 10
    }
    return (
      (MIN_PENALTY + Math.abs(remainingCapacity) * mmPenaltyFactor) *
      singleLayerUsagePenaltyFactor
    )
  }
}
