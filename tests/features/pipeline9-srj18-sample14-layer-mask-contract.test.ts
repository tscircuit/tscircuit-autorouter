import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("SRJ18 sample 14 respects layer policy", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  const [pathing] = solver.portPointPathingSolver!.getConstructorParams()
  expect(pathing.regionLayerMasksAreBinding).toBeFalse()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(238)
  const checked = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
  })
  expect(checked.errors).toHaveLength(0)
})
