import { SolverRuntime } from "@tscircuit/solver-utils"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { RelaxTraceClearanceSolver, type ClearanceComponentInput, type ClearanceComponentOutput } from "@tscircuit/repair04"

export class Pipeline9ClearanceComponentWorker extends BaseSolver {
  static readonly solverName = "Pipeline9ClearanceComponentWorker"
  private output?: ClearanceComponentOutput[]
  constructor(private readonly input: { components: ClearanceComponentInput[] }) { super() }
  override _step(): void {
    this.output = this.input.components.map((component) => RelaxTraceClearanceSolver.solveComponent(component))
    this.solved = true
  }
  getOutput(): ClearanceComponentOutput[] {
    if (!this.output) throw new Error("Clearance components have not completed")
    return this.output
  }
}
SolverRuntime.registerSolver(Pipeline9ClearanceComponentWorker)
