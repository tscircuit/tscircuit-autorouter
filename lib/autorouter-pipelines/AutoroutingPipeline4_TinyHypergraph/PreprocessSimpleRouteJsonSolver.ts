import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import {
  type ConvertSrjToGraphicsObjectOptions,
  convertSrjToGraphicsObject,
} from "lib/utils/convertSrjToGraphicsObject"
import { convertSrjTracesToObstacles } from "lib/utils/convertSrjTracesToObstacles"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"
import { getPresuppliedTraceVisualization } from "lib/utils/getPresuppliedTraceVisualization"

import { getPreRoutingDiagnostics } from "lib/diagnostics/getPreRoutingDiagnostics"

export class PreprocessSimpleRouteJsonSolver extends BaseSolver {
  outputSrj?: SimpleRouteJson

  constructor(
    public readonly inputSrj: SimpleRouteJson,
    public readonly visualizationOptions: ConvertSrjToGraphicsObjectOptions = {},
  ) {
    super()
    this.MAX_ITERATIONS = 1
  }

  protected validatePreRoutingDiagnostics(): boolean {
    const diagnostics = getPreRoutingDiagnostics(this.inputSrj)
    for (const d of diagnostics) {
      this.emitDiagnostic?.(d)
    }
    const blockingError = diagnostics.find(
      (d) => d.severity === "error" && d.recommendedAction === "stop_and_fix",
    )
    if (blockingError) {
      this.error = `[${blockingError.code}] ${blockingError.message}`
      this.failed = true
      return false
    }
    return true
  }

  override _step() {
    if (!this.validatePreRoutingDiagnostics()) return

    const inputSrjWithBoardValidObstacleLayers =
      createSrjWithBoardValidObstacleLayers(this.inputSrj)
    const srjWithPreloadedRouteObstacles =
      convertSrjTracesToObstacles(inputSrjWithBoardValidObstacleLayers) ??
      inputSrjWithBoardValidObstacleLayers

    const srjWithApproximatingRects = addApproximatingRectsToSrj(
      filterObstaclesOutsideBoard(srjWithPreloadedRouteObstacles),
    )
    this.outputSrj = createSrjWithBoardValidObstacleLayers(
      srjWithApproximatingRects,
    )
    this.solved = true
  }

  getOutputSimpleRouteJson() {
    if (!this.outputSrj) {
      throw new Error("PreprocessSimpleRouteJsonSolver has not solved yet")
    }

    return this.outputSrj
  }

  override getConstructorParams() {
    return [this.inputSrj, this.visualizationOptions] as const
  }

  override visualize(): GraphicsObject {
    if (!this.outputSrj)
      return { lines: [], points: [], rects: [], circles: [] }

    return combineVisualizations(
      convertSrjToGraphicsObject(
        { ...this.outputSrj, traces: [] },
        this.visualizationOptions,
      ),
      getPresuppliedTraceVisualization({
        srj: this.outputSrj,
        visualizationOptions: this.visualizationOptions,
      }),
    )
  }
}
