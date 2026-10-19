import type { ReactElement } from "react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "./luma-led-power-phase.srj.json"

export default function LumaLedPowerPhaseFixture(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={capturedInput as SimpleRouteJson}
      createSolver={(inputSrj, options) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
          ...options,
          cacheProvider: null,
        })
      }
    />
  )
}
