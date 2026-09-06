import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 bounds SRJ18 sample 13's high-residual precision pass", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 13)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(Number(repairStats?.postExactIndexedDrcIssueCount)).toBeGreaterThan(16)
  expect(repairStats).toMatchObject({
    postExactPrecisionPassMaxIndexedIssueCount: 16,
    postExactPrecisionPassAttempted: false,
    postExactReferenceValidationAttempted: false,
    postExactReferenceValidationSkippedForIndexedIssueCount: true,
    postExactReferenceAccepted: false,
    terminalEscapeSkippedForIndexedIssueCount: true,
    terminalEscapeCandidateCount: 0,
    terminalEscapeAcceptedCount: 0,
    regionalB01RepairAttempted: false,
    regionalB01RepairCandidateSearchCount: 0,
  })
  expect(
    Number(repairStats?.regionalB01RepairRemainingDrcIssueCount),
  ).toBeGreaterThan(16)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors.length).toBeGreaterThan(0)
})
