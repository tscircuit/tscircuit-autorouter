import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 uses Pipeline7 exact DRC budgets for SRJ23 sample 52", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 52)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    Number(
      solver.pipeline9JointDrcRepairSolver?.stats
        .exactRepairConfiguredMaxIterations,
    ),
  ).toBe(32)
  expect(
    Number(
      solver.pipeline9JointDrcRepairSolver?.stats
        .exactRepairConfiguredViaInPadMaxIterations,
    ),
  ).toBe(32)
  expect(
    Number(
      solver.pipeline9JointDrcRepairSolver?.stats
        .exactRepairConfiguredBroadMaxIterations,
    ),
  ).toBe(12)
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.postExactReferenceAccepted,
  ).toBeTrue()
  expect(
    Number(
      solver.pipeline9JointDrcRepairSolver?.stats
        .postExactReferenceDrcIssueCount,
    ),
  ).toBe(0)
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.regionalB01RepairAttempted,
  ).toBeFalse()
  expect(
    Number(
      solver.pipeline9JointDrcRepairSolver?.stats
        .regionalB01RepairCandidateSearchCount,
    ),
  ).toBe(0)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
