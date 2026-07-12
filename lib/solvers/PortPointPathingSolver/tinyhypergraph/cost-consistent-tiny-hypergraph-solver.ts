import {
  type Candidate,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
  type TinyHyperGraphWorkingState,
} from "tiny-hypergraph/lib/index"
import { IndexedCandidateHeap } from "./indexed-candidate-heap"

export class CostConsistentTinyHyperGraphSolver extends TinyHyperGraphSolver {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
  }

  override _setup(): void {
    super._setup()
    this.state.candidateQueue = new IndexedCandidateHeap(
      this.topology.regionCount,
    ) as unknown as TinyHyperGraphWorkingState["candidateQueue"]
  }

  override computeG(
    currentCandidate: Candidate,
    neighborPortId: number,
  ): number {
    const baseCost = super.computeG(currentCandidate, neighborPortId)
    if (!Number.isFinite(baseCost)) return baseCost

    const dx =
      this.topology.portX[currentCandidate.portId]! -
      this.topology.portX[neighborPortId]!
    const dy =
      this.topology.portY[currentCandidate.portId]! -
      this.topology.portY[neighborPortId]!
    return baseCost + Math.hypot(dx, dy) * this.DISTANCE_TO_COST
  }

  override onPathFound(finalCandidate: Candidate): void {
    const goalPortId = this.state.goalPortId
    if (finalCandidate.portId === goalPortId) {
      super.onPathFound(finalCandidate)
      return
    }

    const g = this.computeG(finalCandidate, goalPortId)
    if (!Number.isFinite(g)) return

    const goalHopId = this.getHopId(goalPortId, finalCandidate.nextRegionId)
    if (g >= this.getCandidateBestCost(goalHopId)) return

    this.setCandidateBestCost(goalHopId, g)
    this.state.candidateQueue.queue({
      prevRegionId: finalCandidate.nextRegionId,
      nextRegionId: finalCandidate.nextRegionId,
      portId: goalPortId,
      g,
      h: 0,
      f: g,
      prevCandidate: finalCandidate,
    })
  }
}
