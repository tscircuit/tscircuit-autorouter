import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./rp2350-v3v3-late-phase-slow.srj.json" with {
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
