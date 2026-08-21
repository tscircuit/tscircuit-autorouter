import type { Candidate } from "tiny-hypergraph/lib/index"
import type { PortId } from "tiny-hypergraph/lib/types"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "./SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

const LAYER_CHANGE_PRIORITY_COST = 1_000_000

const countLayerChanges = (
  candidate: Candidate,
  portZ: Int32Array,
): number => {
  let layerChangeCount = 0
  let currentCandidate: Candidate | undefined = candidate

  while (currentCandidate.prevCandidate) {
    if (
      portZ[currentCandidate.portId] !==
      portZ[currentCandidate.prevCandidate.portId]
    ) {
      layerChangeCount++
    }
    currentCandidate = currentCandidate.prevCandidate
  }

  return layerChangeCount
}

export class MaxViaCountTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  override computeG(
    currentCandidate: Candidate,
    neighborPortId: PortId,
    maximumCost = Number.POSITIVE_INFINITY,
    knownSegmentDistance?: number,
  ): number {
    const currentRouteId = this.state.currentRouteId
    const maxViaCount =
      currentRouteId === undefined
        ? undefined
        : this.problem.routeMetadata?.[currentRouteId]?.simpleRouteConnection
            ?.maxViaCount

    if (maxViaCount === undefined) {
      return super.computeG(
        currentCandidate,
        neighborPortId,
        maximumCost,
        knownSegmentDistance,
      )
    }

    const changesLayer =
      this.topology.portZ[currentCandidate.portId] !==
      this.topology.portZ[neighborPortId]
    const layerChangeCount =
      countLayerChanges(currentCandidate, this.topology.portZ) +
      (changesLayer ? 1 : 0)

    if (layerChangeCount > maxViaCount) {
      return Number.POSITIVE_INFINITY
    }

    const baseCost = super.computeG(
      currentCandidate,
      neighborPortId,
      maximumCost,
      knownSegmentDistance,
    )

    return changesLayer ? baseCost + LAYER_CHANGE_PRIORITY_COST : baseCost
  }
}
