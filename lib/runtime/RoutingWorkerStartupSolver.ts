import { SolverRuntime } from "@tscircuit/solver-utils"
import { BaseSolver } from "../solvers/BaseSolver"

/** Starts the runtime pool while the parent prepares its routing graph. */
export class RoutingWorkerStartupSolver extends BaseSolver {
  static readonly solverName = "RoutingWorkerStartupSolver"

  constructor(_input: Record<string, never>) {
    super()
  }

  override _step(): void {
    this.solved = true
  }

  getOutput(): null {
    return null
  }
}

SolverRuntime.registerSolver(RoutingWorkerStartupSolver)
