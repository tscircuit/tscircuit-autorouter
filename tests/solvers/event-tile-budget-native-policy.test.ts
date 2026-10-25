import { expect, test } from "bun:test"
import { HighDensitySolverA13EventTiles } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13EventTiles"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"

test("a query that cannot reserve preprocessing selects the original kernel before scanning and preserves its output", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "event-insufficient-preprocessing-budget",
      center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
      portPoints: [{ connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 1 }],
    },
    traceThickness: 0.1, traceMargin: 0.1, viaDiameter: 0.3,
    obstacles: [], layerCount: 2, maxSearchIterations: 300,
  }
  const native = new HighDensitySolverA13WithDrcValidation(params)
  const events = new HighDensitySolverA13EventTiles(params)
  native.solve()
  events.solve()
  expect(native.solved).toBe(true)
  expect(events.solved).toBe(true)
  expect(events.getOutput()).toEqual(native.getOutput())
  expect(events.routingIterations).toBe(native.routingIterations)
  expect(events.eventKernel!.diagnostics.queries).toBe(0)
  expect(events.eventKernel!.diagnostics.inputStatesScanned).toBe(0)
  expect(events.selectionDiagnostics.nativeBudgetQueries).toBeGreaterThan(0)
  expect(events.selectionDiagnostics.nativeSearchExpansions).toBe(native.routingIterations)
})
