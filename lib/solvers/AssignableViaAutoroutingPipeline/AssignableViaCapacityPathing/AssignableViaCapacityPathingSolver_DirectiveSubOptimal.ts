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
  SHUFFLE_SEED?: number

  DIRECTIVE_SEED?: number

  FORCE_VIA_TRAVEL_CHANCE?: number
  FAR_VIA_MIN_DISTANCE?: number
}

/**
 * This capacity path solver employs conditional directives. Whether or not the
 * directive applies depends on the pseudo-random hash of the DIRECTIVE_SEED
 *
 * The main conditional directive is whether or not to force the path to go
 * to go through a via then through a far via (if necessary to get to the goal
 * layer). This is useful because it prevents an early path from cutting off
 * all other paths.
 *
 * When forced to traverse via a via, you first select the closest "via" (a
 * via is a node that has availableZ: [0,1]) then a via close
 * to your first via that is a minimum of FAR_VIA_MIN_DISTANCE away. You sort
 * these candidate vias by the weighted sum of the distance to the first via and
 * the goal- seeking to minimize that total distance while staying FAR_VIA_MIN_DISTANCE
 * away from the first via.
 *
 * The visualize() function helps understand the algorithm as it runs by
 * highlighting the selected vias and the path currently being solved. Instead
 * of solving for a single path for a pair of nodes, we now have to solve for
 * multiple paths for multiple pairs of nodes (the middle nodes being the
 * forced vias)
 *
 */
export class AssignableViaCapacityPathingSolver_DirectiveSubOptimal extends CapacityPathingGreedySolver {
  private get hyperParams(): AssignableViaCapacityHyperParameters {
    return this.hyperParameters as AssignableViaCapacityHyperParameters
  }

  constructor(opts: CapacityPathingConstructorParams) {
    super(opts)
    this.applyTraceOrdering()
  }

  private applyTraceOrdering() {
    const seed = this.hyperParams.SHUFFLE_SEED
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
