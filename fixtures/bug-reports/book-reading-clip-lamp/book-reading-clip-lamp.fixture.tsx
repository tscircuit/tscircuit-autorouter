import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./book-reading-clip-lamp.unrouted.srj.json" with {
  type: "json",
}

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={srj as SimpleRouteJson}
      createSolver={(input, opts) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
          ...opts,
          cacheProvider: null,
        })
      }
    />
  )
}
