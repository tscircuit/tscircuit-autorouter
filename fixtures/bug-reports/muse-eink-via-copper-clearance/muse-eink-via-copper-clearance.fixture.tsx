import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "./muse-eink-via-copper-clearance.srj.json"

export default function MuseEinkViaCopperClearanceFixture(): React.JSX.Element {
  return (
    <AutoroutingPipelineDebugger
      srj={capturedInput as SimpleRouteJson}
      createSolver={(inputSrj) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
          cacheProvider: null,
          effort: 1,
        })
      }
    />
  )
}
