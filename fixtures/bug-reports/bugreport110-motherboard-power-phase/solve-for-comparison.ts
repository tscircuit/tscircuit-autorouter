import type {
  PowerTraceExpanderInput,
  PowerTraceExpanderOptions,
} from "@tscircuit/power-trace-expander"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { loadMotherboardPowerPhase } from "./repro"

type FullRouteComparison = {
  output: SimpleRouteJson
  expansionInput: PowerTraceExpanderInput
  expansionOptions: PowerTraceExpanderOptions
}

// Return only the input/output data so CI can release the completed pipeline
// before running the original, memory-intensive expansion implementation.
export function solveForComparison(): FullRouteComparison {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    loadMotherboardPowerPhase(),
    { effort: 1, cacheProvider: null },
  )
  pipeline.solve()
  if (
    !pipeline.solved ||
    pipeline.failed ||
    !pipeline.powerTraceExpansionSolver
  ) {
    throw new Error(`Complete motherboard routing failed: ${pipeline.error}`)
  }
  const expander = pipeline.powerTraceExpansionSolver.powerTraceExpanderSolver
  return {
    output: pipeline.getOutputSimpleRouteJson(),
    expansionInput: expander.inputProblem,
    expansionOptions: expander.options,
  }
}
