import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"
import { getConnectionPointOutsideBoundsError } from "lib/utils/getConnectionPointOutsideBoundsError"
import { getDifferentialPairConstraintError } from "lib/utils/getDifferentialPairConstraintError"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { PreprocessSimpleRouteJsonSolver } from "../AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"
import { getTerminalLayerIndicesByPcbPortId } from "./getTerminalLayerIndicesByPcbPortId"

/**
 * Runs Pipeline7 preprocessing without turning existing traces into obstacle
 * rectangles. The traces remain available for Pipeline9's hypergraph preload.
 */
export class PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver extends PreprocessSimpleRouteJsonSolver {
  override _step(): void {
    this.error = getDifferentialPairConstraintError(this.inputSrj)
    if (this.error) {
      this.failed = true
      return
    }
    this.error = getConnectionPointOutsideBoundsError(this.inputSrj)
    if (this.error) {
      this.failed = true
      return
    }
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

    this.error = getConnectionPointOutsideBoundsError(outputSrj)
    if (this.error) {
      this.failed = true
      return
    }

    const terminalLayerIndicesByPcbPortId = getTerminalLayerIndicesByPcbPortId(
      outputSrj.connections,
      outputSrj.obstacles,
      outputSrj.layerCount,
    )
    // A centered, connected plated hole already provides these copper layers.
    // Preserve that physical access before selecting a terminal's graph region.
    this.outputSrj = {
      ...outputSrj,
      ...(traces === undefined ? {} : { traces }),
      connections: outputSrj.connections.map((connection) => ({
        ...connection,
        pointsToConnect: connection.pointsToConnect.map((point) => {
          const terminalLayerIndices =
            point.pcb_port_id &&
            terminalLayerIndicesByPcbPortId.get(point.pcb_port_id)
          if (!terminalLayerIndices || terminalLayerIndices.size <= 1) {
            return point
          }
          const { layer, ...terminal } = point
          return {
            ...terminal,
            layers: [...terminalLayerIndices].map((z) =>
              mapZToLayerName(z, outputSrj.layerCount),
            ),
          }
        }),
      })),
    }
    this.solved = true
  }
}
