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
  const sweepCount = Number(stats.postExactRegionalSweepCount)
  expect(sweepCount).toBeLessThanOrEqual(2)
  expect(
    Number(stats.boundedRegionalRepairAttemptedRegionCount),
  ).toBeLessThanOrEqual(4 * sweepCount)
  expect(
    Number(stats.boundedRegionalRepairCandidateAttemptCount),
  ).toBeLessThanOrEqual(1_024 * sweepCount)
  expect(
    Number(stats.boundedRegionalRepairPathSearchNodeCount),
  ).toBeLessThanOrEqual(480_000 * sweepCount)
  // Each sweep evaluates its input once. A changed region can evaluate the
  // projection input/output and the complete atomic proposal (three calls).
  expect(
    Number(stats.boundedRegionalRepairReferenceValidationCount),
  ).toBeLessThanOrEqual(
    sweepCount + 3 * Number(stats.boundedRegionalRepairAttemptedRegionCount),
  )
})
