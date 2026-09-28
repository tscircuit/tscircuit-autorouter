import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 does not insert early length-matched traces into the caller's input", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  const originalInput = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("componentDetectionSolver")
  expect(solver.lengthMatchingPostProcessingSolver?.solved).toBe(true)
  expect(input).toEqual(originalInput)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(input).toEqual(originalInput)
})
