import { SolverRuntime } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { BaseSolver } from "../../solvers/BaseSolver"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "./Pipeline9HighDensitySolver"
import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"

export type Pipeline9HighDensityBatchInput = Omit<Pipeline9HighDensitySolverParams, "connMap"> & {
  connectivityNetMap: Record<string, string[]>
  maxIterations: number
}

export type Pipeline9HighDensityBatchOutput = {
  routes: HighDensityIntraNodeRoute[]
  stats: Record<string, number>
  iterations: number
  consumedNodeCount: number
  solved: boolean
  error: string | null
}

/** Evaluate an independent serial batch; the parent owns ordered outcome acceptance. */
export class Pipeline9HighDensityBatchSolver extends BaseSolver {
  static readonly solverName: string = "Pipeline9HighDensityBatchSolver"
  private output?: Pipeline9HighDensityBatchOutput

  constructor(private readonly input: Pipeline9HighDensityBatchInput) {
    super()
  }

  override _step(): void {
    if (this.input.fixedHdRoutes.length !== 0) {
      throw new Error("Parallel high-density batches cannot mutate preloaded copper")
    }
    const solver = new Pipeline9HighDensitySolver({
      ...this.input,
      connMap: new ConnectivityMap(this.input.connectivityNetMap),
    })
    solver.MAX_ITERATIONS = this.input.maxIterations
    solver.solve()
    // Algorithmic failure is an evaluated outcome, consumed in serial node order.
    // Infrastructure/implementation exceptions still reject runtime execution.
    this.output = {
      routes: solver.routes,
      stats: solver.stats,
      iterations: solver.iterations,
      consumedNodeCount: this.input.nodePortPoints.length - solver.unsolvedNodePortPoints.length,
      solved: solver.solved,
      error: solver.error,
    }
    this.solved = true
  }

  getOutput(): Pipeline9HighDensityBatchOutput {
    if (!this.output) {
      throw new Error("High-density batch has not completed")
    }
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9HighDensityBatchSolver)
