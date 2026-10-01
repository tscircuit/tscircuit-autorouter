import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import nema8Srj from "./nema8-default-all-nets.srj.json"

// Exact DEFAULT_ALL_NETS phase input from the board's v1.0.0 release.
const srj = nema8Srj as SimpleRouteJson

export default () => (
  <AutoroutingPipelineDebugger
    srj={srj}
    createSolver={(srj) =>
      new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj), {
        effort: 2,
        cacheProvider: null,
      })
    }
  />
)
