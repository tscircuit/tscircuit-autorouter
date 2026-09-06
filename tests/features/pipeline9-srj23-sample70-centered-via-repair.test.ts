import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateCoreRoutingDrc } from "lib/testing/evaluate-core-routing-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 keeps SRJ23 sample 70 DRC-clean after joint repair", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 70)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateCoreRoutingDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  if (errors.length > 0) {
    console.error(
      JSON.stringify(
        {
          errors,
          jointRepairStats: solver.pipeline9JointDrcRepairSolver?.stats,
        },
        null,
        2,
      ),
    )
  }
  expect(errors).toHaveLength(0)
})
