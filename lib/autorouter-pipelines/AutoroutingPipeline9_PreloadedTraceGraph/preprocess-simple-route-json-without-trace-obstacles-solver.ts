import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"
import { PreprocessSimpleRouteJsonSolver } from "../AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"

/**
 * Runs Pipeline7 preprocessing without turning existing traces into obstacle
 * rectangles. The traces remain available for Pipeline9's hypergraph preload.
 */
export class PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver extends PreprocessSimpleRouteJsonSolver {
  override _step(): void {
    const { traces, ...inputSrjWithoutTraces } = this.inputSrj
    const srjWithBoardValidObstacleLayers =
      createSrjWithBoardValidObstacleLayers(
        inputSrjWithoutTraces as SimpleRouteJson,
      )
    const srjWithApproximatingRects = addApproximatingRectsToSrj(
      filterObstaclesOutsideBoard(srjWithBoardValidObstacleLayers),
    )
    const outputSrj = createSrjWithBoardValidObstacleLayers(
      srjWithApproximatingRects,
    )

    this.outputSrj = traces === undefined ? outputSrj : { ...outputSrj, traces }
    this.solved = true
  }
}
