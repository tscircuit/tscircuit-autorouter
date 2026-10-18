import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("SRJ18 sample 6 counts shared copper once and routes every required pair", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.portPointPathingSolver!.stats.sharedCopperCapacity).toBeTrue()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(255)
  const routedPairs = traces
    .map((trace) => [...trace.connectsTo!].sort())
    .sort()
  const requiredPairs = solver
    .srjWithPointPairs!.connections.map((connection) =>
      connection.pointsToConnect.map((point) => point.pcb_port_id!).sort(),
    )
    .sort()
  expect(routedPairs).toEqual(requiredPairs)
  const checked = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
  })
  expect(checked.errors).toHaveLength(0)
})
