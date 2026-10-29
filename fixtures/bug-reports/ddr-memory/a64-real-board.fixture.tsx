import { sample002 } from "@tscircuit/dataset-srj36-real-ddr"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"

export default function A64RealBoardRepro(): ReactElement {
  return (
    <div>
      <p>
        Original OLIMEX A64-OLinuXino rev H: 75 signal nets, six copper layers.
        Run Pipeline9 from the original board input. The a64-region fixture
        opens the captured cmn_142 request directly for a shorter reproduction.
      </p>
      <AutoroutingPipelineDebugger
        srj={sample002 as unknown as SimpleRouteJson}
        createSolver={(srj) =>
          new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
            effort: 1,
            cacheProvider: null,
          })
        }
      />
    </div>
  )
}
