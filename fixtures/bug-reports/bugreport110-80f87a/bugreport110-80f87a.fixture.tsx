import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "./bugreport110-80f87a.json" with { type: "json" }

export default () => (
  <AutoroutingPipelineDebugger
    srj={bugReport.simple_route_json as SimpleRouteJson}
    createSolver={(input, opts) =>
      new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
        ...opts,
        cacheProvider: null,
      })
    }
  />
)
