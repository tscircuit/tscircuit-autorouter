import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"
import { getConnectionPointOutsideBoundsError } from "lib/utils/getConnectionPointOutsideBoundsError"
import { PreprocessSimpleRouteJsonSolver } from "../AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"

/**
 * Runs Pipeline7 preprocessing without turning existing traces into obstacle
 * rectangles. The traces remain available for Pipeline9's hypergraph preload.
 */
export class PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver extends PreprocessSimpleRouteJsonSolver {
  override _step(): void {
    this.error = getConnectionPointOutsideBoundsError(this.inputSrj)
    if (this.error) {
      this.failed = true
      return
    }
    const { traces, ...inputSrjWithoutTraces } = this.inputSrj
    const viaKeepoutObstacles = inputSrjWithoutTraces.obstacles.filter(
      (obs) => obs.isViaKeepout,
    )
    const nonViaKeepoutObstacles = inputSrjWithoutTraces.obstacles.filter(
      (obs) => !obs.isViaKeepout,
    )
    const mergedViaKeepouts = [
      ...(inputSrjWithoutTraces.viaKeepouts ?? []),
      ...viaKeepoutObstacles.map((obs) => ({
        center: obs.center,
        width: obs.width,
        height: obs.height,
        layers: obs.layers,
        connectedTo: [
          ...(obs.connectedTo ?? []),
          ...(obs.offBoardConnectsTo ?? []),
        ],
        viaClearance: obs.viaClearance ?? obs.minViaEdgeToPadEdgeClearance,
      })),
    ]
    const srjWithBoardValidObstacleLayers =
      createSrjWithBoardValidObstacleLayers({
        ...(inputSrjWithoutTraces as SimpleRouteJson),
        obstacles: nonViaKeepoutObstacles,
        ...(mergedViaKeepouts.length > 0
          ? { viaKeepouts: mergedViaKeepouts }
          : {}),
      })
    const srjWithApproximatingRects = addApproximatingRectsToSrj(
      filterObstaclesOutsideBoard(srjWithBoardValidObstacleLayers),
    )
    const outputSrj = createSrjWithBoardValidObstacleLayers(
      srjWithApproximatingRects,
    )

    this.error = getConnectionPointOutsideBoundsError(outputSrj)
    if (this.error) {
      this.failed = true
      return
    }

    this.outputSrj = traces === undefined ? outputSrj : { ...outputSrj, traces }
    this.solved = true
  }
}
