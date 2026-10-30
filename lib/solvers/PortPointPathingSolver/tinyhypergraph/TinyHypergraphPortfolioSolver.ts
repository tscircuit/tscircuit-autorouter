import { SolverRuntime } from "@tscircuit/solver-utils"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { TinyHyperGraphSectionPipelineInput, TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { TinyHyperGraphSectionPipelineWithTerminalNetIds } from "./TinyHypergraphPortPointPathingSolver"

type PortfolioInput = {
  graph: SerializedHyperGraph
  solveGraphOptions: TinyHyperGraphSectionPipelineInput["solveGraphOptions"]
  sectionSolverOptions: TinyHyperGraphSectionPipelineInput["sectionSolverOptions"]
  traceDensityCostFactor?: number
}

type PortfolioOutput =
  | { status: "solved"; graph: SerializedHyperGraph; iterations: number; graphIterations: number; graphStats: Record<string, unknown>; graphTimeMs: number }
  | { status: "exhausted"; error: string; iterations: number }

/** Independently route a full graph with a specific congestion cost. */
export class TinyHypergraphPortfolioSolver extends BaseSolver {
  static readonly solverName = "TinyHypergraphPortfolioSolver"
  private output?: PortfolioOutput

  constructor(private readonly input: PortfolioInput) {
    super()
  }

  override _step(): void {
    const pipeline = new TinyHyperGraphSectionPipelineWithTerminalNetIds(
      {
        serializedHyperGraph: this.input.graph,
        createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
        solveGraphOptions: {
          ...this.input.solveGraphOptions,
          ...(this.input.traceDensityCostFactor === undefined ? {} : {
            TRACE_DENSITY_COST_FACTOR: this.input.traceDensityCostFactor,
            MAX_ITERATIONS: Math.min(this.input.solveGraphOptions?.MAX_ITERATIONS ?? 500_000, 500_000),
          }),
        },
        sectionSolverOptions: this.input.sectionSolverOptions,
      },
      true,
      true,
    )
    pipeline.solve()
    if (pipeline.failed || !pipeline.solved) {
      if (pipeline.error?.includes("ran out of iterations")) {
        this.output = { status: "exhausted", error: pipeline.error, iterations: pipeline.iterations }
        this.solved = true
        return
      }
      throw new Error(`Parallel route portfolio candidate failed: ${pipeline.error}`)
    }
    const graph = pipeline.getOutput()
    if (!graph) throw new Error("Parallel route portfolio candidate has no output")
    const solver = pipeline.getSolver<TinyHyperGraphSolver>("solveGraph")
    if (!solver) throw new Error("Parallel route portfolio candidate has no graph solver")
    this.output = {
      status: "solved",
      graph,
      iterations: pipeline.iterations,
      graphIterations: solver.iterations,
      graphStats: solver.stats,
      graphTimeMs: pipeline.getStageStats().solveGraph?.timeSpent ?? 0,
    }
    this.solved = true
  }

  getOutput(): PortfolioOutput {
    if (!this.output) throw new Error("Parallel route portfolio candidate has not completed")
    return this.output
  }
}

SolverRuntime.registerSolver(TinyHypergraphPortfolioSolver)
