import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import srjJson from "./xiao-rp2040-pipeline9-drc.srj.json"

const srj = srjJson as SimpleRouteJson

export default function XiaoRp2040Pipeline9Drc(): ReactElement {
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
