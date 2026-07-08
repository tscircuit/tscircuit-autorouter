import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample014 solves without greedy timeout fallback", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14, 0.4)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.4,
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
  expect(portPointPathingSolver?.solved).toBe(true)
  expect(portPointPathingSolver?.failed).toBe(false)
  expect(
    portPointPathingSolver?.stats.neverSuccessfullyRoutedRouteCount ?? 0,
  ).toBe(0)
  expect(
    portPointPathingSolver?.stats.acceptedGreedyFinalRouteOnTimeout,
  ).toBeUndefined()
  expect(
    portPointPathingSolver?.stats.solveGraphSerializationSkipped,
  ).toBeUndefined()
  expect(
    portPointPathingSolver?.stats.sectionOptimizationSkipped,
  ).toBeUndefined()
})
