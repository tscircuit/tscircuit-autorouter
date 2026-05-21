import {
  AutoroutingPipelineSolver4_TinyHypergraph,
  type AutoroutingPipelineSolverOptions,
} from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { PreplacedViaSnapSolver } from "./PreplacedViaSnapSolver"

// Pipeline8 is intended for fab autorouting where the board already contains
// placed via pads, and generated layer transitions must use those vias.
export class AutoroutingPipelineSolver8 extends AutoroutingPipelineSolver4_TinyHypergraph {
  preplacedViaSnapSolver?: PreplacedViaSnapSolver

  constructor(
    srj: ConstructorParameters<
      typeof AutoroutingPipelineSolver4_TinyHypergraph
    >[0],
    opts: AutoroutingPipelineSolverOptions = {},
  ) {
    super(srj, opts)

    const globalDrcStepIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "globalDrcForceImproveSolver",
    )
    const insertIndex =
      globalDrcStepIndex === -1
        ? this.pipelineDef.length
        : globalDrcStepIndex + 1

    this.pipelineDef.splice(insertIndex, 0, {
      solverName: "preplacedViaSnapSolver",
      solverClass: PreplacedViaSnapSolver,
      getConstructorParams: (cms: AutoroutingPipelineSolver8) => [
        {
          hdRoutes:
            cms.globalDrcForceImproveSolver?.getOutput() ??
            cms.traceWidthSolver!.getHdRoutesWithWidths(),
          obstacles: cms.originalSrj.obstacles,
          defaultViaDiameter: cms.viaDiameter,
        },
      ],
    } as any)
  }

  override _getOutputHdRoutes(): HighDensityRoute[] {
    return (
      this.preplacedViaSnapSolver?.getOutput() ??
      this.globalDrcForceImproveSolver?.getOutput() ??
      this.traceWidthSolver?.getHdRoutesWithWidths() ??
      this.traceSimplificationSolver?.simplifiedHdRoutes ??
      this.highDensityStitchSolver!.mergedHdRoutes
    )
  }
}
