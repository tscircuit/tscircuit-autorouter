import type { ReactElement } from "react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./differential-pair-silent-failure.srj.json"

export default function DifferentialPairSilentFailure(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={srj as SimpleRouteJson}
      createSolver={(input, options): AutoroutingPipelineSolver9_PreloadedTraceGraph =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, options)
      }
    />
  )
}
