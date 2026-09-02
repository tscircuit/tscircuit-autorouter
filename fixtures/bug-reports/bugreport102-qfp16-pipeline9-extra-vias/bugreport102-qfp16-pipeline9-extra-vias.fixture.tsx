// @ts-nocheck
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import srj from "./bugreport102-qfp16-pipeline9-extra-vias.srj.json"

export default () => (
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
