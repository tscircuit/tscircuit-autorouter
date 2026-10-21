import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves via transitions while repairing SRJ18 sample 15", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 15)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routes = solver.globalDrcForceImproveSolver!.getOutput()
  const repairedRoute = routes.find(
    (route) => route.connectionName === "source_trace_117__source_net_117_mst3",
  )
  expect(repairedRoute).toBeDefined()
  expect(repairedRoute!.vias).toHaveLength(2)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0)
})
