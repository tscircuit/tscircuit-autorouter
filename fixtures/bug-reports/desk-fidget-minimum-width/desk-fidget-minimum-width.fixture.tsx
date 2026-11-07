import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { ReactElement } from "react"
import { getDeskFidgetMinimumWidthInput } from "./getDeskFidgetMinimumWidthInput"

export default function DeskFidgetMinimumWidth(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={getDeskFidgetMinimumWidthInput("minimum")}
      createSolver={(input, options) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
          ...options,
          cacheProvider: null,
        })
      }
    />
  )
}
