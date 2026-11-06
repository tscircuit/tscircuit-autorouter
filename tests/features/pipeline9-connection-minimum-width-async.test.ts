import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getConnectionMinimumTraceWidthInput } from "../fixtures/connectionMinimumTraceWidthInput"

test("asynchronous Pipeline9 preserves the width-constrained routing result", async (): Promise<void> => {
  const sync = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    getConnectionMinimumTraceWidthInput(),
    { cacheProvider: null },
  )
  sync.solve()
  const asyncSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    getConnectionMinimumTraceWidthInput(),
    { cacheProvider: null },
  )
  await asyncSolver.solveAsync()
  expect(sync.solved).toBe(true)
  expect(asyncSolver.solved).toBe(true)
  expect(asyncSolver.failed).toBe(false)
  expect(asyncSolver.getOutputSimplifiedPcbTraces()).toEqual(
    sync.getOutputSimplifiedPcbTraces(),
  )
})
