// @ts-nocheck
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport86-40bf8e.json"
export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={bugReportJson.simple_route_json}
      createSolver={(srj, opts) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
          ...opts,
          cacheProvider: null,
        })
      }
    />
  )
}
