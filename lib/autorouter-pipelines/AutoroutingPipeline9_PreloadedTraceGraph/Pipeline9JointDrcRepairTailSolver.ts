import { SolverRuntime } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { BaseSolver } from "lib/solvers/BaseSolver"
import {
  Pipeline9JointDrcRepairSolver,
  type Pipeline9JointDrcRepairTailResult,
} from "./Pipeline9JointDrcRepairSolver"

export type Pipeline9JointDrcRepairTailInput = {
  params: Omit<
    ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0],
    "connMap"
  >
  netMap: Record<string, string[]>
  cancellation: Int32Array
}

/** Compute the existing post-bounded-repair stages without publishing a proposal. */
export class Pipeline9JointDrcRepairTailSolver extends BaseSolver {
  static readonly solverName = "Pipeline9JointDrcRepairTailSolver"
  private output?: Pipeline9JointDrcRepairTailResult

  constructor(private readonly input: Pipeline9JointDrcRepairTailInput) {
    super()
  }

  override _step(): void {
    this.output = Pipeline9JointDrcRepairSolver.solveSpeculativeTail(
      { ...this.input.params, connMap: new ConnectivityMap(this.input.netMap) },
      this.input.cancellation,
    )
    this.solved = true
  }

  getOutput(): Pipeline9JointDrcRepairTailResult {
    if (!this.output) throw new Error("Joint repair tail has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9JointDrcRepairTailSolver)
