import { expect, test } from "bun:test"
import { TestPointSolver } from "../../lib/solvers/TestPointSolver/TestPointSolver"
import type { SimpleRouteJson } from "../../lib/types"

test("probe center spacing can reject a second pad even when copper clearance permits it", () => {
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [], connections: [],
    traces: [{ type: "pcb_trace", pcb_trace_id: "signal", connection_name: "signal", route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
    ] }] }
  const solver = new TestPointSolver(input, {
    requests: ["TP1", "TP2"].map(name => ({ name, pcbTraceId: "signal", diameter: 0.2, layer: "bottom" })),
    clearance: 0.1, minProbeSpacing: 2.54, maxDetour: 0,
  })
  expect(() => solver.solve()).toThrow("TP2")
  expect(() => solver.getOutput()).toThrow("has not solved")
  expect(input.traces![0]!.route).toHaveLength(2)
})
