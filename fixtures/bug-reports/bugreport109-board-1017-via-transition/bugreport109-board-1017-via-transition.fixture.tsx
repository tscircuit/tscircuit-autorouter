import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import board from "./board-1017.srj.json"

export default function Board1017ViaTransitionBugReport(): React.JSX.Element {
  return (
    <div>
      <div style={{ padding: 16 }}>
        <h2>Board #1017 — missing route transition during via merging</h2>
        <p>
          Reported in Pipeline 9: SameNetViaMergerSolver could not find a route
          transition for via (-5.8, -22.1) on source_net_0_mst44. The original
          screenshot is saved beside this fixture as reported-failure.png.
        </p>
      </div>
      <AutoroutingPipelineDebugger
        srj={board as SimpleRouteJson}
        createSolver={(srj, opts): AutoroutingPipelineSolver9_PreloadedTraceGraph =>
          new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
            ...opts,
            cacheProvider: null,
          })
        }
      />
    </div>
  )
}
