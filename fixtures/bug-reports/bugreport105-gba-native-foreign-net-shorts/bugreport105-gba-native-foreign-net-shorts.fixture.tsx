import type { JSX } from "react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "./bugreport105-gba-native-foreign-net-shorts.srj.json" with {
  type: "json",
}

const createSolver = (
  srj: SimpleRouteJson,
): AutoroutingPipelineSolver9_PreloadedTraceGraph => {
  return new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
  })
}

export default function GameBoyNativeForeignNetShorts(): JSX.Element {
  const srj = structuredClone(capturedInput) as SimpleRouteJson
  return (
    <AutoroutingPipelineDebugger srj={srj} createSolver={createSolver} />
  )
}
