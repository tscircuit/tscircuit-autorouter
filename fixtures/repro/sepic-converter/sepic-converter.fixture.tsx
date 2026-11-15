import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import srj from "./sepic-converter.srj.json"

export default (): ReactElement => (
  <AutoroutingPipelineDebugger
    srj={srj as SimpleRouteJson}
    createSolver={(input, opts) =>
      new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
        ...opts,
        cacheProvider: null,
        effort: 1,
      })
    }
  />
)
