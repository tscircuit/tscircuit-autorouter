import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"
import { PreprocessSimpleRouteJsonSolver } from "../AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"
import { expandImplicitBoundsToConnectedObstacles } from "./expand-implicit-bounds-to-connected-obstacles"
import { inferPreloadedTraceConnectivity } from "./infer-preloaded-trace-connectivity"

export class PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver extends PreprocessSimpleRouteJsonSolver {
  override _step(): void {
    const inputSrjWithTraceConnectivity = inferPreloadedTraceConnectivity(
      this.inputSrj,
    )
    const { traces, ...inputSrjWithoutTraces } = inputSrjWithTraceConnectivity
    const srjWithBoardValidObstacleLayers =
      createSrjWithBoardValidObstacleLayers(inputSrjWithoutTraces)
    const srjWithExpandedImplicitBounds =
      expandImplicitBoundsToConnectedObstacles(
        filterObstaclesOutsideBoard(srjWithBoardValidObstacleLayers),
      )
    const srjWithApproximatingRects = addApproximatingRectsToSrj(
      srjWithExpandedImplicitBounds,
    )
    const outputSrj = createSrjWithBoardValidObstacleLayers(
      srjWithApproximatingRects,
    )

    this.outputSrj = traces === undefined ? outputSrj : { ...outputSrj, traces }
    this.solved = true
  }
}
