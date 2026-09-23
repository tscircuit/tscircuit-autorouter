import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test.failing("Pipeline9 length matching tight-preload safety", (): void => {
  const srj = createPipeline9LengthMatchingPreloadedInput(0.3)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("lengthMatchingPostProcessingSolver")
  const before = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getNewTracesBeforePowerExpansion(),
  })
  expect(before.errors).toHaveLength(0)
  expect(() => solver.solve()).toThrow(
    "exhausted all segment/tooth combinations",
  )
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output",
  )
})
