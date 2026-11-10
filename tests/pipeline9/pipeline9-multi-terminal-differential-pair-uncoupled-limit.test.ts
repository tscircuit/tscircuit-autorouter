import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { multiTerminalDifferentialPair } from "../fixtures/multiTerminalDifferentialPair"

test("Pipeline9 throws when a segment cannot satisfy the terminal escape limit", (): void => {
  const srj = structuredClone(multiTerminalDifferentialPair)
  srj.differentialPairs![0]!.maxUncoupledLength = 0
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })

  expect((): void => solver.solve()).toThrow(
    "Differential pair segment post-processing failed:",
  )
  expect(solver.failed).toBe(true)
})
