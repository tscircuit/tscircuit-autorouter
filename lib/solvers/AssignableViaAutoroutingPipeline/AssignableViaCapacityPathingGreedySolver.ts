import { CapacityPathingGreedySolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingGreedySolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import type { CapacityMeshNode } from "lib/types"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import type { CapacityPathingSolver } from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver"

type CapacityPathingConstructorParams = ConstructorParameters<
  typeof CapacityPathingGreedySolver
>[0]

type AssignableViaCapacityHyperParameters = Partial<CapacityHyperParameters> & {
  TRACE_ORDERING_SEED?: number
  LAYER_TRAVERSAL_REWARD?: number
  LAYER_TRAVERSAL_HEURISTIC_FACTOR?: number
  SINGLE_LAYER_TRANSITION_REWARD_FACTOR?: number
}

export class AssignableViaCapacityPathingGreedySolver extends CapacityPathingGreedySolver {
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

  private get layerTraversalReward() {
    return this.hyperParams.LAYER_TRAVERSAL_REWARD ?? 0.75
  }

  private get layerTraversalHeuristicFactor() {
    return this.hyperParams.LAYER_TRAVERSAL_HEURISTIC_FACTOR ?? 0.5
  }

  private get singleLayerTransitionFactor() {
    return this.hyperParams.SINGLE_LAYER_TRANSITION_REWARD_FACTOR ?? 0.5
  }

  private computeLayerTraversalReward(
    prevNode: CapacityMeshNode,
    node: CapacityMeshNode,
  ) {
    if (!prevNode || !node) return 0

    const prevLayers = prevNode.availableZ ?? []
    const nextLayers = node.availableZ ?? []

    const newLayerCount = nextLayers.filter(
      (layer) => !prevLayers.includes(layer),
    ).length

    let reward = 0

    if (newLayerCount > 0) {
      reward += this.layerTraversalReward * newLayerCount
    }

    if (
      prevLayers.length === 1 &&
      nextLayers.length === 1 &&
      prevLayers[0] !== nextLayers[0]
    ) {
      reward += this.layerTraversalReward * this.singleLayerTransitionFactor
    }

    return reward
  }

  computeG(
    prevCandidate: Parameters<CapacityPathingSolver["computeG"]>[0],
    node: Parameters<CapacityPathingSolver["computeG"]>[1],
    endGoal: Parameters<CapacityPathingSolver["computeG"]>[2],
  ) {
    const baseG = super.computeG(prevCandidate, node, endGoal)
    const reward = this.computeLayerTraversalReward(prevCandidate.node, node)
    return Math.max(0, baseG - reward)
  }

  computeH(
    prevCandidate: Parameters<CapacityPathingSolver["computeH"]>[0],
    node: Parameters<CapacityPathingSolver["computeH"]>[1],
    endGoal: Parameters<CapacityPathingSolver["computeH"]>[2],
  ) {
    const baseH = super.computeH(prevCandidate, node, endGoal)
    const reward =
      this.computeLayerTraversalReward(prevCandidate.node, node) *
      this.layerTraversalHeuristicFactor
    return Math.max(0, baseH - reward)
  }
}
