import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "./bugreport106-ab9d90.json"

export default () => (
  <AutoroutingPipelineDebugger
    srj={bugReport.simple_route_json as SimpleRouteJson}
    createSolver={(srj, opts) =>
      new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, opts)
    }
  />
)
