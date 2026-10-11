import { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { IntraNodeRouteSolver } from "../../solvers/HighDensitySolver/IntraNodeSolver"
import { ReplayMultiHeadPolyLineSolver } from "./ReplayMultiHeadPolyLineSolver"
import type { MultiHeadHistoryDispatcher, MultiHeadHistoryJob } from "./parallelMultiHeadHistoryTypes"

export class ParallelPortfolioSingleIntraNodeSolver extends PortfolioSingleIntraNodeSolver {
  private readonly dispatcher: MultiHeadHistoryDispatcher
  private readonly historyCandidates = new Map<number, ReplayMultiHeadPolyLineSolver>()
  private readonly admittedCandidates = new Set<number>()
  private requestedAtExpansion = false
  private requestedAtSelection = false

  constructor(
    params: ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0],
    dispatcher: MultiHeadHistoryDispatcher,
  ) {
    super(params)
    this.dispatcher = dispatcher
  }

  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    if (!hyperParameters.MULTI_HEAD_POLYLINE_SOLVER) return super.generateSolver(hyperParameters)
    const solver = new ReplayMultiHeadPolyLineSolver({
      nodeWithPortPoints: this.nodeWithPortPoints,
      connMap: this.connMap, hyperParameters,
      viaDiameter: this.constructorParams.viaDiameter,
    })
    this.historyCandidates.set(this.historyCandidates.size, solver)
    return solver as unknown as IntraNodeRouteSolver
  }

  async prepareForNextStep(): Promise<void> {
    if (this.solved || this.failed) return
    if (!this.supervisedSolvers) {
      this.initializeSolvers()
      // Original initialization happens inside the upcoming BaseSolver.step.
      // Its dynamic limit is affine in that parent iteration, one above this one.
      this.MAX_ITERATIONS++
      this.stats.dynamicSupervisorIterationLimit = this.MAX_ITERATIONS
    }
    const selected = this.getSupervisedSolverWithBestFitness()?.solver
    const requestAtExpansion = this.adaptiveSearchExpanded && !this.requestedAtExpansion
    const requestAtSelection = selected instanceof ReplayMultiHeadPolyLineSolver && !this.requestedAtSelection
    if (requestAtExpansion || requestAtSelection) {
      this.requestedAtExpansion ||= requestAtExpansion
      this.requestedAtSelection ||= requestAtSelection
      await this.requestHistories(selected instanceof ReplayMultiHeadPolyLineSolver ? selected : undefined)
    }
    if (selected instanceof ReplayMultiHeadPolyLineSolver) await selected.prepareForNextStep()
  }

  private async requestHistories(selected?: ReplayMultiHeadPolyLineSolver): Promise<void> {
    const candidates = [...this.historyCandidates].filter(([id, solver]) =>
      !this.admittedCandidates.has(id) && solver.iterations === 0 && !solver.solved && !solver.failed)
    candidates.sort((a, b) => Number(b[1] === selected) - Number(a[1] === selected))
    if (candidates.length === 0) return
    const jobs: MultiHeadHistoryJob[] = candidates.map(([candidateId, solver]) => ({
      kind: "multiHeadHistory", candidateId,
      params: { nodeWithPortPoints: solver.nodeWithPortPoints, hyperParameters: solver.hyperParameters,
        viaDiameter: solver.viaDiameter },
      connectivityNetMap: this.connMap?.netMap ?? {},
      connectivityIdToNetMap: this.connMap?.idToNetMap ?? {},
    }))
    const admitted = await this.dispatcher(jobs)
    for (const [id, request] of admitted) {
      const solver = this.historyCandidates.get(id)
      if (!solver) throw new Error(`Multi-head grant names unknown candidate ${id}`)
      solver.setHistoryRequest(request)
      this.admittedCandidates.add(id)
    }
  }
}
