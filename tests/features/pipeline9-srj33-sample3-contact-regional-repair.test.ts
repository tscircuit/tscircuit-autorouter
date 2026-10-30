import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves regional repair for contacts left by a completed exact portfolio", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj33", 3)
  const solver: AutoroutingPipelineSolver9_PreloadedTraceGraph =
    new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      { cacheProvider: null, effort: 1 },
    )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  // Pair repair clears four more issues at the cost of two additional vias.
  expect(errors.length).toBeLessThanOrEqual(3)
  let viaCount: number = 0
  for (const trace of routedTraces) {
    for (const point of trace.route) {
      if (point.route_type === "via") viaCount++
    }
  }
  expect(viaCount).toBeLessThanOrEqual(114)
})
