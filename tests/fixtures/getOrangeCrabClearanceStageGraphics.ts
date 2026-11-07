import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types/srj-types"

type Pipeline = AutoroutingPipelineSolver9_PreloadedTraceGraph
type HighDensitySolver = NonNullable<Pipeline["highDensityRouteSolver"]>
type B01Solver = NonNullable<HighDensitySolver["activeB01Solver"]>

export function getOrangeCrabClearanceStageGraphics(): GraphicsObject {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "./assets/orangecrab-native-remaining.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const pipeline: Pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    input,
  )
  let b01: B01Solver | null = null
  while (!pipeline.solved && !pipeline.failed) {
    const hd: HighDensitySolver | undefined = pipeline.highDensityRouteSolver
    if (hd?.activeNode?.capacityMeshNodeId === "topology_merge_7827") {
      b01 = hd.activeB01Solver
    }
    pipeline.step()
    // The parent clears completed children in the same step. Keep the actual
    // child so its native view is captured before regional fallback runs.
    if (b01 && (b01.solved || b01.failed)) return b01.visualize()
  }
  throw new Error(
    "OrangeCrab pipeline did not reach B01 region topology_merge_7827",
  )
}
