import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { ReactElement } from "react"
import { getDeskFidgetVssaMinimumWidthInput } from "./getDeskFidgetMinimumWidthInput"

export default function DeskFidgetVssaMinimumWidth(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={getDeskFidgetVssaMinimumWidthInput()}
      createSolver={(input, options) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
          ...options,
          cacheProvider: null,
        })
      }
    />
  )
}
