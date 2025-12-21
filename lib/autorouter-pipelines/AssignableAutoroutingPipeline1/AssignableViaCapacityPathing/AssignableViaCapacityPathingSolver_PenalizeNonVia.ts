import { CapacityPathingGreedySolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingGreedySolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import type { CapacityMeshNode } from "lib/types"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import type {
  Candidate,
  CapacityPathingSolver,
} from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver"

type CapacityPathingConstructorParams = ConstructorParameters<
  typeof CapacityPathingGreedySolver
>[0]

type AssignableViaCapacityHyperParameters = Partial<CapacityHyperParameters> & {
  TRACE_ORDERING_SEED?: number
  LAYER_TRAVERSAL_REWARD?: number
}

export class AssignableViaCapacityPathingSolver_PenalizeNonVia extends CapacityPathingGreedySolver {
  private get hyperParams(): AssignableViaCapacityHyperParameters {
    return this.hyperParameters as AssignableViaCapacityHyperParameters
  }

  constructor(opts: CapacityPathingConstructorParams) {
    super(opts)
    this.applyTraceOrdering()
  }

  private applyTraceOrdering() {
    const seed = this.hyperParams.TRACE_ORDERING_SEED
    if (seed === undefined) return
    this.connectionsWithNodes = cloneAndShuffleArray(
      this.connectionsWithNodes,
      seed,
    ) as typeof this.connectionsWithNodes
  }

  getTotalCapacity(node: CapacityMeshNode): number {
    return 0.5
  }

  doesNodeHaveCapacityForTrace(
    node: CapacityMeshNode,
    prevNode: CapacityMeshNode,
  ) {
    const usedCapacity =
      this.usedNodeCapacityMap.get(node.capacityMeshNodeId) ?? 0

    if (usedCapacity > 0) return false

    return true
  }

  computeG(
    prevCandidate: Parameters<CapacityPathingSolver["computeG"]>[0],
    node: Parameters<CapacityPathingSolver["computeG"]>[1],
    endGoal: Parameters<CapacityPathingSolver["computeG"]>[2],
  ) {
    // If same layer as prev node, add penalty
    let stepsSinceLayerChange = 0
    const currentLayer = node.availableZ[0]
    let prevCursor: Candidate | null = prevCandidate
    while (prevCursor) {
      if (prevCursor.node.availableZ[0] === currentLayer) {
        stepsSinceLayerChange++
      } else {
        break
      }
      prevCursor = prevCursor.prevCandidate
    }

    const hasMultipleLayerChanges = Boolean(prevCursor?.prevCandidate)

    const sameLayerPenalty = hasMultipleLayerChanges
      ? 0
      : stepsSinceLayerChange * 10

    // TODO HUGE penalty if the distance between the layer change is small-
    // this doesn't give a large enough gap for other traces to get through

    return super.computeG(prevCandidate, node, endGoal) + sameLayerPenalty
  }

  computeH(
    prevCandidate: Parameters<CapacityPathingSolver["computeH"]>[0],
    node: Parameters<CapacityPathingSolver["computeH"]>[1],
    endGoal: Parameters<CapacityPathingSolver["computeH"]>[2],
  ) {
    return super.computeH(prevCandidate, node, endGoal)
  }
}
