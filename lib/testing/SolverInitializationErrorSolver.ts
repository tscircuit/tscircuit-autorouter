import { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createConnectionRegionErrorVisualization } from "lib/utils/createConnectionRegionErrorVisualization"

type PipelineStepDefinition = {
  solverName: string
}

export class SolverInitializationErrorSolver extends BaseSolver {
  pipelineDef: PipelineStepDefinition[] = []
  currentPipelineStepIndex = 0

  constructor(
    public srj: SimpleRouteJson,
    public creationError: unknown,
  ) {
    super()
    this.failed = true
    this.error =
      creationError instanceof Error
        ? creationError.message
        : String(creationError)
  }

  override getSolverName(): string {
    return "SolverInitializationErrorSolver"
  }

  override visualize(): GraphicsObject {
    const errorVisualization: GraphicsObject | null =
      createConnectionRegionErrorVisualization({
        srj: this.srj,
        error: this.creationError,
      })
    return errorVisualization ?? convertSrjToGraphicsObject(this.srj)
  }
}
