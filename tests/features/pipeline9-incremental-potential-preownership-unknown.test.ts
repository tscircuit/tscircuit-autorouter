import { expect, test } from "bun:test"
import type { NegotiatedClearanceInput } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/NegotiateTraceClearanceSolver"

test("UNKNOWN before the reserved rollback copy completes explicitly advertises the caller-owned boundary", () => {
  const input: NegotiatedClearanceInput = { srj: { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [] }, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, routes: [{ connectionName: "wire", rootConnectionName: "own", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0, pcb_port_id: "a" }, { x: 1, y: 0, z: 0, pcb_port_id: "b" }], vias: [] }], dirtyRouteIndices: [0], isLocked: () => false, allowLayerChanges: true, traceClearance: 0.1, viaClearance: 0.1, maxPathSearchNodes: 10000, maxPathSearchCalls: 2 }
  const solver = new NegotiateTraceClearanceSolver(input, 0)
  solver.solve()
  const result = solver.getOutput()
  expect(solver.stats.aggregateUnknown).toBe(true)
  expect(result.routes).toBe(input.routes)
  expect(result.pathSearchCalls).toBe(0)
  expect(result.pathSearchNodes).toBe(0)
  expect(result.aggregateWork).toBe(0)
  expect(solver.workBudget.counters.preOwnershipUnknowns).toBe(1)
  expect(solver.workBudget.counters.ownedRollbackUnknowns).toBe(0)
  expect(solver.workBudget.counters.rollbackSnapshotsComplete).toBe(0)
  expect(solver.workBudget.counters.ownedValuesCopied).toBe(0)
})
