import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver7_MultiGraph,
  getPipeline7PostProcessingEffortConfig,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("pipeline7 effort-50 post-processing converges and cleans post-DRC vias on srj18 sample011", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 11, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  // Isolate the stage that consumed one million SameNetViaMerger steps in the
  // full effort-50 benchmark.
  solver.solveUntilPhase("traceSimplificationSolver")
  expect(solver.failed).toBe(false)
  solver.effort = 50
  solver.postProcessingEffortConfig = getPipeline7PostProcessingEffortConfig(50)
  solver.solveUntilPhase("lengthMatchingSolver")

  expect(solver.failed).toBe(false)
  expect(solver.getCurrentPhase()).toBe("lengthMatchingSolver")
  expect(solver.traceSimplificationSolver?.solved).toBe(true)
  expect(
    solver.traceSimplificationSolver?.simplificationPipelineLoops,
  ).toBeLessThanOrEqual(6)
  expect(solver.traceSimplificationSolver?.iterations).toBeLessThan(100_000)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.postDrcTraceSimplificationSolver?.solved).toBe(true)
  expect(
    solver.postDrcTraceSimplificationSolver?.stats
      .simplificationInitialDrcIssueCount,
  ).toBe(5)
  expect(
    solver.postDrcTraceSimplificationSolver?.stats
      .simplificationFinalDrcIssueCount,
  ).toBe(3)
  expect(
    solver.postDrcTraceSimplificationSolver?.simplificationPipelineLoops,
  ).toBeLessThanOrEqual(6)
}, 240_000)
