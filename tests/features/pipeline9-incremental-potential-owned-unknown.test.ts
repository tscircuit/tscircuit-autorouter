import { expect, test } from "bun:test"
import type { NegotiatedClearanceInput } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/NegotiateTraceClearanceSolver"

test("aggregate UNKNOWN after ownership returns a precharged private mutable rollback preserving geometry and terminal identities", () => {
  const makeInput = (): NegotiatedClearanceInput => ({ srj: { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [] }, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, routes: [{ connectionName: "wire", rootConnectionName: "own", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0, pcb_port_id: "a" }, { x: 1, y: 0, z: 0, pcb_port_id: "b" }], vias: [] }], dirtyRouteIndices: [0], isLocked: () => false, allowLayerChanges: true, traceClearance: 0.1, viaClearance: 0.1, maxPathSearchNodes: 10000, maxPathSearchCalls: 2 })
  const calibration = new NegotiateTraceClearanceSolver(makeInput())
  calibration.step()
  const cap = calibration.workBudget.counters.aggregateWork
  const input = makeInput(), expected = structuredClone(input.routes)
  const solver = new NegotiateTraceClearanceSolver(input, cap)
  solver.step()
  expect(solver.solved).toBe(false)
  expect(solver.input.routes).not.toBe(input.routes)
  expect(Object.isFrozen(solver.input.routes[0]!.route[0])).toBe(true)
  input.routes[0]!.connectionName = "foreign-mutated"
  input.routes[0]!.rootConnectionName = "foreign-root"
  input.routes[0]!.route[0]!.x = -100
  input.routes[0]!.route[0]!.pcb_port_id = "foreign-terminal"
  solver.solve()
  const result = solver.getOutput()
  expect(solver.stats.aggregateUnknown).toBe(true)
  expect(result.routes).toEqual(expected)
  expect(result.routes).not.toBe(input.routes)
  expect(result.routes).not.toBe(solver.input.routes)
  expect(Object.isFrozen(result.routes[0]!.route[0])).toBe(false)
  expect(solver.workBudget.counters.rollbackSnapshotsComplete).toBe(1)
  expect(solver.workBudget.counters.ownedRollbackUnknowns).toBe(1)
  expect(solver.workBudget.counters.preOwnershipUnknowns).toBe(0)
  expect(result.aggregateWork).toBe(cap)
  result.routes[0]!.route[0]!.x = -0.75
  expect(result.routes[0]!.route[0]!.x).toBe(-0.75)
  expect(solver.input.routes[0]!.route[0]!.x).toBe(-1)
})
