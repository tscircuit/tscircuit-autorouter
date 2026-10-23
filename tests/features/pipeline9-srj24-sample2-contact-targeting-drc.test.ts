import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 clears migrated SRJ24 sample 2 using physical contact targeting", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 2)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: solver.getOutputSimpleRouteJson(),
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: [],
    includeBoardClearance: true,
  })
  expect(errors).toEqual([])
})
