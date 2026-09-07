import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 bounds SRJ18 sample 13's high-residual precision pass", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 13)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(repairStats?.postExactReferenceValidationAttempted).toBeTrue()
  expect(Number(repairStats?.terminalEscapeCandidateCount)).toBeLessThanOrEqual(
    256,
  )
  expect(
    Number(repairStats?.regionalB01RepairCandidateSearchCount),
  ).toBeLessThanOrEqual(
    Number(repairStats?.regionalB01RepairCandidateSearchBudget),
  )
  expect(
    Number(repairStats?.clearancePrecisionCandidateCount),
  ).toBeLessThanOrEqual(24)
  expect(
    Number(repairStats?.boundedRegionalRepairAttemptedRegionCount),
  ).toBeLessThanOrEqual(4)
  expect(
    Number(repairStats?.boundedRegionalRepairCandidateAttemptCount),
  ).toBeLessThanOrEqual(1_024)
  expect(
    Number(repairStats?.boundedRegionalRepairPathSearchNodeCount),
  ).toBeLessThanOrEqual(480_000)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors.length).toBeLessThanOrEqual(
    Number(repairStats?.postExactReferenceDrcIssueCount),
  )
})
