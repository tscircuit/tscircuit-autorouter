import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline7 residual local rerouting improves srj18 sample011", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 11, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  // Keep every preceding stage at low effort so this test measures only the
  // residual local-reroute stage.
  solver.solveUntilPhase("residualLocalRerouteSolver")
  expect(solver.failed).toBe(false)
  solver.effort = 50
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.residualLocalRerouteSolver?.solved).toBe(true)
  const stats = solver.residualLocalRerouteSolver?.stats
  const initialDrcIssueCount = stats?.residualLocalRerouteInitialDrcIssueCount
  const finalDrcIssueCount = stats?.residualLocalRerouteFinalDrcIssueCount
  const attempts = stats?.residualLocalRerouteCandidateAttempts
  const maxAttempts = stats?.residualLocalRerouteMaxCandidateAttempts

  if (
    typeof initialDrcIssueCount !== "number" ||
    typeof finalDrcIssueCount !== "number" ||
    typeof attempts !== "number" ||
    typeof maxAttempts !== "number"
  ) {
    throw new Error("Expected residual local-reroute solver statistics")
  }

  expect(initialDrcIssueCount).toBeGreaterThan(0)
  // Low-effort preceding stages can leave via-clearance errors owned by the
  // via-merging stage, so this trace-local stage must strictly improve them.
  expect(finalDrcIssueCount).toBeLessThan(initialDrcIssueCount)
  expect(attempts).toBeLessThan(maxAttempts)
  expect(stats?.residualLocalRerouteHitCandidateLimit).toBe(false)
})
