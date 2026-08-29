import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensitySolver } from "../../solvers/HighDensitySolver/HighDensitySolver"
import { normalizePipeline9NodeRootConnectionNames } from "../AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import type {
  Pipeline9NetworkedHighDensityNodeInput,
  Pipeline9NetworkedHighDensityNodeOutput,
} from "./pipeline9-networked-types"

/**
 * Runs the exact ordinary-node solver used by Pipeline9. hd-cache2 calls this
 * exported helper so a cache entry can only be produced by its installed
 * autorouter implementation.
 */
export function solvePipeline9NetworkedHighDensityNode(
  input: Pipeline9NetworkedHighDensityNodeInput,
): Pipeline9NetworkedHighDensityNodeOutput {
  if (input.effort !== 1) {
    throw new Error(
      `Pipeline9 networked high-density solving requires effort=1, received ${input.effort}`,
    )
  }

  const connMap = new ConnectivityMap(input.connectivityNetMap)
  const solver = new HighDensitySolver({
    nodePortPoints: [
      normalizePipeline9NodeRootConnectionNames(
        input.nodeWithPortPoints,
        connMap,
      ),
    ],
    colorMap: input.colorMap,
    connMap,
    viaDiameter: input.viaDiameter,
    traceWidth: input.traceWidth,
    obstacleMargin: input.obstacleMargin,
    effort: input.effort,
    nodePfById: {
      [input.nodeWithPortPoints.capacityMeshNodeId]: input.nodePf,
    },
    obstacles: input.obstacles,
    layerCount: input.layerCount,
    useGrowShrinkHighDensityIntraNodeSolver: true,
    preserveTerminalPcbPortIds: false,
    growShrinkFallbackToInvalidGeometryOnFailure: false,
    captureSearchDebug: false,
  })

  solver.solve()
  if (solver.solved) {
    return { status: "solved", routes: solver.routes }
  }

  return {
    status: "failed",
    error: solver.error ?? "Pipeline9 ordinary high-density solver failed",
  }
}
