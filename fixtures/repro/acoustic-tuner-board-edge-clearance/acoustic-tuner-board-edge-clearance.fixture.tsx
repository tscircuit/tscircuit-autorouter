import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import input from "./input.srj.json"

export default function AcousticTunerBoardEdgeClearance(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={input as SimpleRouteJson}
      createSolver={(
        inputSrj,
        opts,
      ): AutoroutingPipelineSolver9_PreloadedTraceGraph => {
        return new AutoroutingPipelineSolver9_PreloadedTraceGraph(
          structuredClone(inputSrj),
          { ...opts, cacheProvider: null },
        )
      }}
    />
  )
}
