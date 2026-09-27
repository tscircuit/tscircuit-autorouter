import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./bugreport109-board-1017-via-transition.srj.json"

export default function Board1017ViaTransitionBugReport(): React.JSX.Element {
  return (
    <AutoroutingPipelineDebugger
      srj={srj as SimpleRouteJson}
      createSolver={(srj, opts): AutoroutingPipelineSolver9_PreloadedTraceGraph =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
          ...opts,
          cacheProvider: null,
        })
      }
    />
  )
}
