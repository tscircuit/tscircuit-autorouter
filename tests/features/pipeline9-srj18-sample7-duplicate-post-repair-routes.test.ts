import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 simplifies duplicate post-repair route names in SRJ18 sample 7", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 7)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const postRepairRoutes =
    solver.pipeline9JointDrcRepairSolver?.getOutput() ?? []
  expect(
    new Set(postRepairRoutes.map((route) => route.connectionName)).size,
  ).toBeLessThan(postRepairRoutes.length)
  expect(solver.postRepairTraceSimplificationSolver?.solved).toBeTrue()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toEqual([])
}, 120_000)
