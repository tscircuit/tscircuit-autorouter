import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 routes SRJ18 sample 13 within its regional work budget", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 13)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  const initialRepairAccepted =
    repairStats?.initialBoundedRegionalRepairAccepted === true
  if (initialRepairAccepted) {
    expect(repairStats.initialBoundedRegionalRepairPublishedDrcIssueCount).toBe(
      0,
    )
    expect(
      solver.pipeline9JointDrcRepairSolver?.exactRepairSolver,
    ).toBeUndefined()
  } else {
    expect(repairStats?.postExactReferenceValidationAttempted).toBeTrue()
  }
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
    Number(
      initialRepairAccepted
        ? repairStats?.initialBoundedRegionalRepairAttemptedRegionCount
        : repairStats?.boundedRegionalRepairAttemptedRegionCount,
    ),
  ).toBeLessThanOrEqual(8)
  expect(
    Number(
      initialRepairAccepted
        ? repairStats?.initialBoundedRegionalRepairCandidateAttemptCount
        : repairStats?.boundedRegionalRepairCandidateAttemptCount,
    ),
  ).toBeLessThanOrEqual(1_024)
  expect(
    Number(
      initialRepairAccepted
        ? repairStats?.initialBoundedRegionalRepairPathSearchNodeCount
        : repairStats?.boundedRegionalRepairPathSearchNodeCount,
    ),
  ).toBeLessThanOrEqual(10_000_000)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  // The corrected DRC exposes 69 remaining violations in the merged route.
  // Keep a ceiling so improved routes pass without hiding regressions.
  expect(errors.length).toBeLessThanOrEqual(69)
})
