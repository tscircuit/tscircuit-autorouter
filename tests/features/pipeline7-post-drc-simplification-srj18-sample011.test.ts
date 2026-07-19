import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline7 post-DRC simplification improves srj18 sample011", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 11, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  // Keep every preceding stage at low effort so this test measures only the
  // newly added post-DRC simplification stage.
  solver.solveUntilPhase("postDrcTraceSimplificationSolver")
  expect(solver.failed).toBe(false)
  solver.effort = 50
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.postDrcTraceSimplificationSolver?.solved).toBe(true)
  const stats = solver.postDrcTraceSimplificationSolver?.stats
  const initialDrcIssueCount = stats?.simplificationInitialDrcIssueCount
  const finalDrcIssueCount = stats?.simplificationFinalDrcIssueCount

  if (
    typeof initialDrcIssueCount !== "number" ||
    typeof finalDrcIssueCount !== "number"
  ) {
    throw new Error("Expected post-DRC simplification DRC count statistics")
  }

  expect(finalDrcIssueCount).toBeLessThan(initialDrcIssueCount)
  expect(initialDrcIssueCount - finalDrcIssueCount).toBeGreaterThanOrEqual(1)
  expect(
    solver.postDrcTraceSimplificationSolver?.simplificationPipelineLoops,
  ).toBeLessThanOrEqual(6)
})
