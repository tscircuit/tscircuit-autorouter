import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import type { TinyHyperGraphSolver, TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "../SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { DenseRoutingWorkspace } from "./DenseRoutingWorkspace"
import { PreparedRoutingGeometry } from "./PreparedRoutingGeometry"

class PreparedFinalRouteSolver extends SelectiveReripTinyHyperGraphSolver {
  private readonly workspace: DenseRoutingWorkspace
  remainingReripBudget = 0

  constructor(topology: TinyHyperGraphSolver["topology"], problem: TinyHyperGraphSolver["problem"], options: TinyHyperGraphSolverOptions, geometry: PreparedRoutingGeometry) {
    super(topology, problem, options)
    this.workspace = new DenseRoutingWorkspace(geometry)
  }

  override _step(): void {
    if (!this.workspace.step(this)) super._step()
  }

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    if (this.state.ripCount >= this.remainingReripBudget) {
      this.failed = true
      this.error = "Congestion-aware final routing exhausted its rerip budget"
    }
  }
}

export class PreparedPortPointRoutingSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  private readonly geometry = new PreparedRoutingGeometry(this.topology)
  private readonly workspace = new DenseRoutingWorkspace(this.geometry)
  private asyncRunning = false

  override _step(): void {
    const routeId = this.state.currentRouteId
    if ((routeId !== undefined && this.partialRipRoutePlans.has(routeId)) || !this.workspace.step(this)) super._step()
  }

  protected override createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver {
    if (attempt >= 0) return super.createGreedyFinalRouteSolver(options, attempt)
    const solver = new PreparedFinalRouteSolver(this.topology, this.problem, {
      ...options, MAX_ITERATIONS: Math.max(options.MAX_ITERATIONS ?? 50_000, this.MAX_ITERATIONS * 2),
    }, this.geometry)
    solver.remainingReripBudget = this.costAwareFinalReripBudget - this.state.ripCount
    return solver
  }

  async solveAsync(runtime?: SolverRuntimeExecutor, stopAtIteration = Infinity): Promise<void> {
    if (this.asyncRunning) throw new Error("Prepared routing solveAsync is already running")
    this.asyncRunning = true
    try {
      if (runtime && !this.solved && !this.failed && this.iterations < stopAtIteration) await this.geometry.prepareAsync(runtime)
      while (!this.solved && !this.failed && this.iterations < stopAtIteration) this.step()
    } catch (error) {
      this.failed = true
      this.error = `Prepared routing execution failed: ${error}`
      throw error
    } finally { this.asyncRunning = false }
  }
}
