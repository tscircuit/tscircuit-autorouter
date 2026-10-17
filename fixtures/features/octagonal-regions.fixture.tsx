import { AutoroutingPipelineSolver6 } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import srj from "./octagonal-regions.json"

export default function OctagonalRegionsFixture(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={srj as SimpleRouteJson}
      createSolver={(input, opts) => new AutoroutingPipelineSolver6(input, {
        ...opts,
        polyRegionShape: "octagonal",
      })}
    />
  )
}
