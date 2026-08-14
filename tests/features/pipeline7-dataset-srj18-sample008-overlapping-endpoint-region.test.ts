import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 dataset-srj18 sample008 picks routable overlapping endpoint region", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 8, 0.1)
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

  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.failed).toBe(false)
  expect(
    solver.portPointPathingSolver?.stats.staticallyUnroutableRouteCount ?? 0,
  ).toBe(0)
  const optimizerMetrics =
    solver.portPointPathingSolver?.getSolveGraphBenchmarkMetrics()?.optimizer
  expect(optimizerMetrics).toBeDefined()
  expect(optimizerMetrics!.finalMaxRegionCost).toBeLessThanOrEqual(
    optimizerMetrics!.initialMaxRegionCost,
  )
  expect(optimizerMetrics!.finalTotalRegionCost).toBeLessThan(
    optimizerMetrics!.initialTotalRegionCost,
  )
})
