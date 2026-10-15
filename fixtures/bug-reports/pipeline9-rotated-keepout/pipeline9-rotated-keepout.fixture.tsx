import type { ReactElement } from "react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./pipeline9-rotated-keepout.srj.json"

export default function Pipeline9RotatedKeepoutFixture(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={srj as SimpleRouteJson}
      createSolver={(inputSrj, opts) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
          ...opts,
          cacheProvider: null,
        })
      }
    />
  )
}
