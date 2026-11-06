import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getConnectionMinimumTraceWidthInput } from "../fixtures/connectionMinimumTraceWidthInput"

test("an impossible connection minimum fails during planning instead of emitting thin copper", (): void => {
  const input = getConnectionMinimumTraceWidthInput()
  // The obstacles now span the board, so neither end has a legal detour.
  for (const obstacle of input.obstacles) {
    if (obstacle.connectedTo.length === 0) obstacle.width = 30
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("WIDE_POWER")
  expect(solver.error).toContain("minimum trace width 0.4mm")
  expect(solver.getCurrentPhase()).toBe("portPointPathingSolver")
})
