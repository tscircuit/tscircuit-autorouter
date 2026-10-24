import { expect, test } from "bun:test"
import type { NegotiatedClearanceInput } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/NegotiateTraceClearanceSolver"

test("production negotiation owns immutable geometry and preserves mutable output and terminal metadata", () => {
  const routes: NegotiatedClearanceInput["routes"] = [{ connectionName: "wire", rootConnectionName: "own", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0, pcb_port_id: "a" }, { x: 1, y: 0, z: 0, pcb_port_id: "b" }], vias: [] }]
  const input: NegotiatedClearanceInput = { srj: { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [] }, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, routes, dirtyRouteIndices: [0], isLocked: () => false, allowLayerChanges: true, traceClearance: 0.1, viaClearance: 0.1, maxPathSearchNodes: 10000, maxPathSearchCalls: 2 }
  const solver = new NegotiateTraceClearanceSolver(input)
  solver.step()
  expect(solver.input.routes).not.toBe(routes)
  expect(Object.isFrozen(solver.input.routes[0]!.route[0])).toBe(true)
  routes[0]!.route[0]!.x = -1.5
  input.srj.obstacles.push({ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1, layers: ["top"], connectedTo: ["foreign"] })
  solver.solve()
  const output = solver.getOutput()
  expect(output.routes[0]!.route[0]).toEqual({ x: -1, y: 0, z: 0, pcb_port_id: "a" })
  expect(output.routes[0]!.route.at(-1)).toEqual({ x: 1, y: 0, z: 0, pcb_port_id: "b" })
  expect(Object.isFrozen(output.routes[0]!.route[0])).toBe(false)
  expect(output.aggregateWork).toBeLessThanOrEqual(10000)
  expect(solver.workBudget.counters.ownedValuesCopied).toBeGreaterThan(0)
})
