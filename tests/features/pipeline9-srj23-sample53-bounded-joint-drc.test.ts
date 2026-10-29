import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 uses Pipeline7 exact DRC budgets for SRJ23 sample 53", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 53)
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
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
