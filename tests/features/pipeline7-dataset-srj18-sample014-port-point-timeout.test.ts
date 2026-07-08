import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample014 solves port point pathing at default effort", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    cacheProvider: null,
  })

  solver.solveUntilPhase("portPointPathingSolver")

  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  const portPointPathingSolver = solver.portPointPathingSolver

  expect(solver.failed).toBe(false)
  expect(portPointPathingSolver?.failed).toBe(false)
  expect(portPointPathingSolver?.solved).toBe(true)
  expect(
    portPointPathingSolver?.stats.metadataPortPenaltyCount,
  ).toBeGreaterThan(0)
})
