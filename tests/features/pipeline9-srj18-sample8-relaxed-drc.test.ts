import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ18 sample 8's crowded trace/via clearances", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 8)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
  const repairStats = solver.pipeline9JointDrcRepairSolver!.stats
  expect(repairStats.clearancePrecisionRepaired).toBeTrue()
  expect(Number(repairStats.clearancePrecisionCandidateCount)).toBeGreaterThan(
    0,
  )
  expect(
    Number(repairStats.clearancePrecisionCandidateCount),
  ).toBeLessThanOrEqual(24)
})
