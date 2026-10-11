import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver"
import { addApproximatingRectsToSrj } from "../../utils/addApproximatingRectsToSrj"
import { createSrjWithBoardValidObstacleLayers } from "../../utils/create-srj-with-board-valid-obstacle-layers"
import { filterObstaclesOutsideBoard } from "../../utils/filterObstaclesOutsideBoard"
import { getConnectionPointOutsideBoundsError } from "../../utils/getConnectionPointOutsideBoundsError"
import type { SimpleRouteJson } from "../../types"

/** Retains physical copper separately from the original routing approximation. */
export class PhysicalPreprocessSimpleRouteJsonSolver extends PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver {
  override _step(): void {
    this.error = getConnectionPointOutsideBoundsError(this.inputSrj)
    if (this.error) { this.failed = true; return }
    const { traces, ...inputWithoutTraces } = this.inputSrj
    const boardValid = createSrjWithBoardValidObstacleLayers(inputWithoutTraces as SimpleRouteJson)
    const rectangles = addApproximatingRectsToSrj(filterObstaclesOutsideBoard(boardValid), { preserveCopperGeometry: true })
    const output = createSrjWithBoardValidObstacleLayers(rectangles)
    this.error = getConnectionPointOutsideBoundsError(output)
    if (this.error) { this.failed = true; return }
    this.outputSrj = traces === undefined ? output : { ...output, traces }
    this.solved = true
  }
}
