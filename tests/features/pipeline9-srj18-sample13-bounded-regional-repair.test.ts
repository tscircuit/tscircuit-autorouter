import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 clears SRJ18 sample 13 within bounded regional work", async (): Promise<void> => {
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
  const sweepCount = Number(repairStats?.postExactRegionalSweepCount)
  expect(sweepCount).toBeLessThanOrEqual(2)
  expect(Number(repairStats?.terminalEscapeCandidateCount)).toBeLessThanOrEqual(
    256 * sweepCount,
  )
  expect(
    Number(repairStats?.regionalB01RepairCandidateSearchCount),
  ).toBeLessThanOrEqual(
    Number(repairStats?.regionalB01RepairCandidateSearchBudget),
  )
  expect(
    Number(repairStats?.boundedRegionalRepairAttemptedRegionCount),
  ).toBeLessThanOrEqual(4 * sweepCount)
  expect(
    Number(repairStats?.boundedRegionalRepairCandidateAttemptCount),
  ).toBeLessThanOrEqual(1_024 * sweepCount)
  expect(
    Number(repairStats?.boundedRegionalRepairPathSearchNodeCount),
  ).toBeLessThanOrEqual(480_000 * sweepCount)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
