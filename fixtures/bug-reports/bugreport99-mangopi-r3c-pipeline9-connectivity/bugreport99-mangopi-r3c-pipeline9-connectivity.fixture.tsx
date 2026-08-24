import type { ReactElement } from "react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "./bugreport99-mangopi-r3c-pipeline9-connectivity.srj.json" with {
  type: "json",
}

const srj = simpleRouteJson as SimpleRouteJson

export default function Bugreport99MangoPiPipeline9Fixture(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={srj}
      createSolver={(inputSrj) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
          effort: 1,
          cacheProvider: null,
        })
      }
    />
  )
}
