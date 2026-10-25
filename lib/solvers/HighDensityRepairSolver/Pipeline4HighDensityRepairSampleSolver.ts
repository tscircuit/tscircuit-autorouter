import { SolverRuntime } from "@tscircuit/solver-utils"
import type { DatasetSample, HdRoute } from "high-density-repair02"
import { buildRepairFrames } from "high-density-repair02/lib/high-density-repair-solver/steps/buildRepairFrames"
import { BaseSolver } from "../BaseSolver"

export type Pipeline4HighDensityRepairSampleInput = {
  sample: DatasetSample
  margin: number
}

export type Pipeline4HighDensityRepairSampleOutput = {
  repairedRoutes: HdRoute[]
  clearanceStats: ReturnType<typeof buildRepairFrames>["clearanceRepairStats"]
}

/** Node samples all read the original geometry; acceptance remains in node order. */
export class Pipeline4HighDensityRepairSampleSolver extends BaseSolver {
  static readonly solverName: string = "Pipeline4HighDensityRepairSampleSolver"
  private output?: Pipeline4HighDensityRepairSampleOutput

  constructor(private readonly input: Pipeline4HighDensityRepairSampleInput) {
    super()
  }

  override _step(): void {
    const result = buildRepairFrames(
      this.input.sample,
      this.input.margin,
      false,
      false,
    )
    if (result.frames.length !== 1) {
      throw new Error("Node repair must complete in one frame")
    }
    // The wrapper's trace diagnostics and visualization do not affect repairs.
    this.output = {
      repairedRoutes: result.repairedRoutes,
      clearanceStats: result.clearanceRepairStats,
    }
    this.solved = true
  }

  getOutput(): Pipeline4HighDensityRepairSampleOutput {
    if (!this.output) throw new Error("Node repair sample has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline4HighDensityRepairSampleSolver)
