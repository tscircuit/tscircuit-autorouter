import { expect, test } from "bun:test"
import { TestPointSolver } from "../../lib/solvers/TestPointSolver/TestPointSolver"
import type { SimpleRouteJson } from "../../lib/types"

test("a bounded detour makes room for a pad without moving an unrelated trace", () => {
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [], connections: [],
    traces: [
      { type: "pcb_trace", pcb_trace_id: "target", connection_name: "signal", route: [
        { route_type: "wire", x: -2, y: 0, width: 0.2, layer: "top" },
        { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "top" }] },
      { type: "pcb_trace", pcb_trace_id: "other", connection_name: "other", route: [
        { route_type: "wire", x: -3, y: 0.5, width: 0.2, layer: "top" },
        { route_type: "wire", x: 3, y: 0.5, width: 0.2, layer: "top" }] },
    ] }
  const options = { requests: [{ name: "TP", pcbTraceId: "target", layer: "top" as const, diameter: 1 }],
    clearance: 0.2, minProbeSpacing: 2.54, maxDetour: 0 }
  const blocked = new TestPointSolver(input, options)
  expect(() => blocked.solve()).toThrow("No clearance-safe")
  expect(() => blocked.getOutput()).toThrow("has not solved")
  const solver = new TestPointSolver(input, { ...options, maxDetour: 1 })
  solver.solve()
  expect(solver.getOutput().testPoints[0]!.y).toBeLessThan(0)
  expect(solver.getOutput().traces![1]).toEqual(input.traces![1])
})
