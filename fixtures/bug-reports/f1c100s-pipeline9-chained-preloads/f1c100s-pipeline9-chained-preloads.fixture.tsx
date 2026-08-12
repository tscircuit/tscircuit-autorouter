// @ts-nocheck
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import srj from "./f1c100s-pipeline9-chained-preloads.srj.json"

export default (): JSX.Element => (
  <AutoroutingPipelineDebugger
    srj={srj}
    createSolver={(inputSrj, opts) =>
      new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
        ...opts,
        cacheProvider: null,
      })
    }
  />
)
