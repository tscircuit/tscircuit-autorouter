import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves SRJ18 sample 9's reference-clean exact output", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(Number(repairStats?.finalDrcIssueCount)).toBeGreaterThan(0)
  expect(repairStats).toMatchObject({
    postExactPrecisionPassAttempted: true,
    postExactReferenceValidationAttempted: true,
    postExactReferenceValidationSkippedForIndexedIssueCount: false,
    postExactReferenceDrcIssueCount: 0,
    postExactReferenceAccepted: true,
    terminalEscapeSkippedForIndexedIssueCount: false,
    terminalEscapeCandidateCount: 0,
    terminalEscapeAcceptedCount: 0,
    regionalB01RepairAttempted: false,
    regionalB01RepairCandidateSearchCount: 0,
  })
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
