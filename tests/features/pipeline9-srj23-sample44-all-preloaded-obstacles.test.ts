import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 jointly repairs preloaded routes in SRJ23 sample 44", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 44)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    // Keep these defects available to the joint-repair stage under test.
    { cacheProvider: null, effort: 1, enableRepair04: false },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.initialJointDrcIssueCount,
  ).toBeGreaterThan(0)
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.movablePreloadedTraceCount,
  ).toBeGreaterThan(0)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
