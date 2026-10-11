import { TinyHyperGraphSolver, type TinyHyperGraphSectionPipelineInput, type TinyHyperGraphTopology, type TinyHyperGraphProblem, type TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/index"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { TinyBitsetHyperGraphSolver } from "./TinyBitsetHyperGraphSolver"
import { TinyBitsetSelectiveReripHyperGraphSolver } from "./TinyBitsetSelectiveReripHyperGraphSolver"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "./TinyIndexedSelectiveReripHyperGraphSolver"

export type Pipeline9PathingStrategy = "indexed" | "adaptive-bitset" | "cached-cost"
export type Pipeline9PathingOptions = { strategy?: Pipeline9PathingStrategy }
type TinyPipeline = ReturnType<TinyHypergraphPortPointPathingSolver["createTinyPipeline"]>

class CachedCostHyperGraphSolver extends TinyBitsetHyperGraphSolver {
  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, options?: TinyHyperGraphSolverOptions) {
    super(topology, problem, options, {
      minimumBitsetSegmentCount: Number.POSITIVE_INFINITY, enableRegionCostCache: true,
    })
  }
}

class CachedCostSelectiveHyperGraphSolver extends TinyBitsetSelectiveReripHyperGraphSolver {
  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, options?: TinyHyperGraphSolverOptions) {
    super(topology, problem, options, {
      minimumBitsetSegmentCount: Number.POSITIVE_INFINITY, enableRegionCostCache: true,
    })
  }
}

export class ParallelPortPointPathingSolver extends TinyHypergraphPortPointPathingSolver {
  // The base constructor calls createTinyPipeline before subclass initialization.
  // A declare-only capture survives that call; configure it before routing begins.
  declare private createdTinyPipeline: TinyPipeline
  private pathingStrategy?: Pipeline9PathingStrategy

  constructor(
    params: ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0],
    options: Pipeline9PathingOptions = {},
  ) {
    super(params)
    this.pathingStrategy = options.strategy ?? "indexed"
    this.configureTinyPipeline(this.createdTinyPipeline, this.pathingStrategy)
  }

  protected override createTinyPipeline(
    inputProblem: TinyHyperGraphSectionPipelineInput,
    useSelectiveReripRouting: boolean,
  ): TinyPipeline {
    const pipeline = super.createTinyPipeline(inputProblem, useSelectiveReripRouting)
    this.createdTinyPipeline = pipeline
    if (this.pathingStrategy !== undefined) this.configureTinyPipeline(pipeline, this.pathingStrategy)
    return pipeline
  }

  private configureTinyPipeline(pipeline: TinyPipeline, strategy: Pipeline9PathingStrategy): void {
    const solveGraphStep = pipeline.pipelineDef.find((step) => step.solverName === "solveGraph")
    if (!solveGraphStep) throw new Error("Tiny hypergraph pipeline is missing the solveGraph stage")
    const selective = pipeline.useSelectiveReripRouting
    switch (strategy) {
      case "indexed":
        solveGraphStep.solverClass = selective ? TinyIndexedSelectiveReripHyperGraphSolver : TinyHyperGraphSolver
        return
      case "adaptive-bitset":
        solveGraphStep.solverClass = selective ? TinyBitsetSelectiveReripHyperGraphSolver : TinyBitsetHyperGraphSolver
        return
      case "cached-cost":
        solveGraphStep.solverClass = selective ? CachedCostSelectiveHyperGraphSolver : CachedCostHyperGraphSolver
        return
      default:
        throw new Error(`Unknown Pipeline9 pathing strategy: ${strategy}`)
    }
  }
}
