// @ts-nocheck
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import srj from "./bugreport94-rv1106g2-late-gpio.srj.json"

export default () => (
  <AutoroutingPipelineDebugger
    srj={srj}
    createSolver={(inputSrj, opts) =>
      new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, opts)
    }
  />
)
