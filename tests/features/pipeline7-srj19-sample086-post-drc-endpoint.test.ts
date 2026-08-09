import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline7 keeps srj19 sample86 DRC-clean after endpoint via removal", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj19", 86)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const viaCount = routedTraces.reduce(
    (sum, trace) =>
      sum + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )
  const drc = evaluateRelaxedDrc({
    inputSrj: solver.originalSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })

  expect(drc.errors).toHaveLength(0)
  expect(viaCount).toBe(24)
})
