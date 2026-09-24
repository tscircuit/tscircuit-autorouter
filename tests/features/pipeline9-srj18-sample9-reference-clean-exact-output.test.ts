import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reports SRJ18 sample 9's reference-clean output after precision repair", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  // Precision repair clears the complete MST's remaining physical clearance.
  expect(Number(repairStats?.finalDrcIssueCount)).toBe(0)
  expect(repairStats).toMatchObject({
    postExactReferenceValidationAttempted: true,
    postExactReferenceDrcIssueCount: 0,
    postExactReferenceAccepted: true,
    clearancePrecisionReferenceValidationCount: 1,
    clearancePrecisionRepaired: true,
    terminalEscapeCandidateCount: 0,
    terminalEscapeAcceptedCount: 0,
    regionalB01RepairAttempted: false,
    regionalB01RepairCandidateSearchCount: 0,
  })
  expect(Number(repairStats?.clearancePrecisionCandidateCount)).toBeGreaterThan(
    0,
  )
  expect(
    Number(repairStats?.clearancePrecisionCandidateValidationCount),
  ).toBeGreaterThan(0)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
