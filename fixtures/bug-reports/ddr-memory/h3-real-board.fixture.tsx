import { sample001 } from "@tscircuit/dataset-srj36-real-ddr"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"

export default function H3RealBoardRepro(): ReactElement {
  return (
    <div>
      <p>
        Original Allwinner H3 DDR3 board: 53 signal nets, two copper layers.
        Step to uniformPortDistributionSolver to inspect cmn_21 / cmn_9, then
        continue through high-density routing. Full-board completion and DRC
        remain separate outcomes.
      </p>
      <AutoroutingPipelineDebugger
        srj={sample001 as unknown as SimpleRouteJson}
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
