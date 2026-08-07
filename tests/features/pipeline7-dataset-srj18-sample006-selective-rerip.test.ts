import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 rejects srj18 sample006 instead of accepting crossing port paths", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario)

  solver.solveUntilPhase("portPointPathingSolver")
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(true)
  expect(solver.portPointPathingSolver?.failed).toBe(true)
  expect(solver.portPointPathingSolver?.solved).toBe(false)
  expect(solver.portPointPathingSolver?.error).toContain(
    "ran out of iterations",
  )
  expect(
    solver.portPointPathingSolver?.stats.acceptedGreedyFinalRouteOnTimeout,
  ).toBeUndefined()
  expect(
    solver.portPointPathingSolver?.stats.neverSuccessfullyRoutedRouteCount,
  ).toBe(1)
})
