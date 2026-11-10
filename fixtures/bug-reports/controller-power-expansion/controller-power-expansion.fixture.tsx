import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import srjJson from "./controller-power-expansion.srj.json"

const srj = srjJson as SimpleRouteJson

export default function ControllerPowerExpansion(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={srj}
      createSolver={(inputSrj, options) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
          ...options,
          cacheProvider: null,
        })
      }
    />
  )
}
