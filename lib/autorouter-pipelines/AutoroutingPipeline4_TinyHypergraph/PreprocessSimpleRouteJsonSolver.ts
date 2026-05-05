import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { convertSrjTracesToObstacles } from "lib/utils/convertSrjTracesToObstacles"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"
import { getPresuppliedTraceVisualization } from "lib/utils/getPresuppliedTraceVisualization"

export class PreprocessSimpleRouteJsonSolver extends BaseSolver {
  outputSrj?: SimpleRouteJson

  constructor(public readonly inputSrj: SimpleRouteJson) {
    super()
    this.MAX_ITERATIONS = 1
  }

  override _step() {
    const srjWithPreloadedRouteObstacles =
      convertSrjTracesToObstacles(this.inputSrj) ?? this.inputSrj

    this.outputSrj = addApproximatingRectsToSrj(
      filterObstaclesOutsideBoard(srjWithPreloadedRouteObstacles),
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
    return [this.inputSrj] as const
  }

  override visualize(): GraphicsObject {
    if (!this.outputSrj)
      return { lines: [], points: [], rects: [], circles: [] }

    return combineVisualizations(
      convertSrjToGraphicsObject({ ...this.outputSrj, traces: [] }),
      getPresuppliedTraceVisualization(this.outputSrj),
    )
  }
}
