import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 completes srj18 sample006 through its congested BGA escape ports", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
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
    portPointPathingSolver?.stats.duplicateCongestedPortSourceCount,
  ).toBeGreaterThan(0)
  expect(portPointPathingSolver?.getOutput().nodesWithPortPoints.length).toBeGreaterThan(0)
})
