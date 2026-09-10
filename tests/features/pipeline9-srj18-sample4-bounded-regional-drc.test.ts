import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 4 within its regional work budget", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 4)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
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
  const stats = solver.pipeline9JointDrcRepairSolver!.stats
  expect(
    Number(stats.boundedRegionalRepairAttemptedRegionCount),
  ).toBeLessThanOrEqual(4)
  expect(
    Number(stats.boundedRegionalRepairCandidateAttemptCount),
  ).toBeLessThanOrEqual(1_024)
  expect(
    Number(stats.boundedRegionalRepairPathSearchNodeCount),
  ).toBeLessThanOrEqual(480_000)
  // One eligibility check skips the early pass for scattered errors, then
  // the existing repair performs at most five reference validations.
  expect(
    Number(stats.boundedRegionalRepairReferenceValidationCount),
  ).toBeLessThanOrEqual(6)
})
