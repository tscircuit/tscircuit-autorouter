import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPipeline9BoundedRepairBudget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 2 within its regional work budget", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 2)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1 },
  )
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toEqual([])
  const jointSolver = solver.pipeline9JointDrcRepairSolver!
  const stats = jointSolver.stats
  // This board uses the existing congestion-scaled budget, not the fixed
  // small-board defaults. Keep the zero-DRC requirement above unchanged.
  const budget = getPipeline9BoundedRepairBudget(
    jointSolver.getOutput().length,
    Number(stats.postExactReferenceDrcIssueCount),
    jointSolver.params.effort,
  )
  expect(
    Number(stats.boundedRegionalRepairAttemptedRegionCount),
  ).toBeLessThanOrEqual(budget.maxRegions)
  expect(
    Number(stats.boundedRegionalRepairCandidateAttemptCount),
  ).toBeLessThanOrEqual(budget.maxCandidateAttempts)
  expect(
    Number(stats.boundedRegionalRepairPathSearchNodeCount),
  ).toBeLessThanOrEqual(budget.maxPathSearchNodes)
})
