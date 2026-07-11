import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 completes every port path for dataset-srj18 sample006", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6, 1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 1,
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
  expect(portPointPathingSolver?.stats.solveGraphRouteCount).toBe(255)
  expect(portPointPathingSolver?.stats.solveGraphSolvedRouteCount).toBe(255)
  expect(
    portPointPathingSolver?.getOutput().nodesWithPortPoints.length,
  ).toBeGreaterThan(0)
})
