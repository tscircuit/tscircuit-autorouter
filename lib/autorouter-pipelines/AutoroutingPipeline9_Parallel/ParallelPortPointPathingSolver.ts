import type { TinyHyperGraphSectionPipelineInput } from "tiny-hypergraph/lib/index"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { TinyBitsetHyperGraphSolver } from "./TinyBitsetHyperGraphSolver"
import { TinyBitsetSelectiveReripHyperGraphSolver } from "./TinyBitsetSelectiveReripHyperGraphSolver"

export class ParallelPortPointPathingSolver extends TinyHypergraphPortPointPathingSolver {
  protected override createTinyPipeline(
    inputProblem: TinyHyperGraphSectionPipelineInput,
    useSelectiveReripRouting: boolean,
  ): ReturnType<TinyHypergraphPortPointPathingSolver["createTinyPipeline"]> {
    const pipeline = super.createTinyPipeline(inputProblem, useSelectiveReripRouting)
    const solveGraphStep = pipeline.pipelineDef.find((step) => step.solverName === "solveGraph")
    if (!solveGraphStep) throw new Error("Tiny hypergraph pipeline is missing the solveGraph stage")
    solveGraphStep.solverClass = useSelectiveReripRouting
      ? TinyBitsetSelectiveReripHyperGraphSolver
      : TinyBitsetHyperGraphSolver
    return pipeline
  }
}
