import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("SRJ24 sample 15 keeps shared copper consistent across physical stages", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 15)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.portPointPathingSolver!.stats.sharedCopperCapacity).toBeTrue()
  expect(
    solver.highDensityRouteSolver!.stats.sharedCopperConnectionCount,
  ).toBeGreaterThan(0)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const requiredPairs = solver
    .srjWithPointPairs!.connections.map((connection) =>
      connection.pointsToConnect.map((point) => point.pcb_port_id!).sort(),
    )
    .sort()
  const routedPairs = traces
    .map((trace) => [...trace.connectsTo!].sort())
    .sort()
  expect(routedPairs).toEqual(requiredPairs)
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors,
  ).toHaveLength(0)
})
