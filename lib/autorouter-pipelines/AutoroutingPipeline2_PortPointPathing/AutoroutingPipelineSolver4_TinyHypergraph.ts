import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"
import {
  AutoroutingPipelineSolver3_HgPortPointPathing,
  type AutoroutingPipelineSolverOptions,
} from "./AutoroutingPipelineSolver3_HgPortPointPathing"

type MutablePipelineStep = {
  solverName: string
  solverClass: new (...args: any[]) => any
  getConstructorParams: (instance: any) => any[]
  onSolved?: (instance: any) => void
}

export class AutoroutingPipelineSolver4_TinyHypergraph extends AutoroutingPipelineSolver3_HgPortPointPathing {
  override portPointPathingSolver?: TinyHypergraphPortPointPathingSolver

  constructor(
    srj: SimpleRouteJson,
    opts: AutoroutingPipelineSolverOptions = {},
  ) {
    super(srj, opts)

    this.pipelineDef = (this.pipelineDef as MutablePipelineStep[])
      .filter((step) => step.solverName !== "hyperGraphSectionOptimizer")
      .map((step) =>
        step.solverName === "portPointPathingSolver"
          ? {
              ...step,
              solverClass: TinyHypergraphPortPointPathingSolver,
            }
          : step,
      ) as typeof this.pipelineDef
  }
}

export {
  AutoroutingPipelineSolver4_TinyHypergraph as AutoroutingPipelineSolver4,
}
