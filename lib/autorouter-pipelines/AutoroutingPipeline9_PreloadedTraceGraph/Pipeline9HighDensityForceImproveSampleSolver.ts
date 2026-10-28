import { SolverRuntime } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"

export type Pipeline9HighDensityForceImproveSampleInput = ConstructorParameters<
  typeof HighDensityForceImproveSolver
>[0]

export type Pipeline9HighDensityForceImproveSampleOutput = {
  routes: ReturnType<HighDensityForceImproveSolver["getOutput"]>
  latestVisualization: GraphicsObject
}

/** Run the upstream numerical step on one node already assigned by the host. */
export class Pipeline9HighDensityForceImproveSampleSolver extends BaseSolver {
  static readonly solverName: string =
    "Pipeline9HighDensityForceImproveSampleSolver"
  private output?: Pipeline9HighDensityForceImproveSampleOutput

  constructor(
    private readonly input: Pipeline9HighDensityForceImproveSampleInput,
  ) {
    super()
  }

  override _step(): void {
    const solver = new HighDensityForceImproveSolver(this.input)
    const entry = solver.sampleEntries[0]
    if (
      this.input.nodeWithPortPoints.length !== 1 ||
      solver.sampleEntries.length !== 1 ||
      entry.routeIndexes.length !== this.input.hdRoutes.length ||
      entry.routeIndexes.some((routeIndex, index) => routeIndex !== index)
    ) {
      throw new Error("Force-improve task must contain one preassigned node")
    }
    solver.step()
    if (!solver.solved || solver.failed || solver.iterations !== 1) {
      throw new Error("Force-improve node must complete in one step")
    }
    this.output = {
      routes: solver.getOutput(),
      latestVisualization: solver.latestVisualization,
    }
    this.solved = true
  }

  getOutput(): Pipeline9HighDensityForceImproveSampleOutput {
    if (!this.output) throw new Error("Force-improve node has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9HighDensityForceImproveSampleSolver)
