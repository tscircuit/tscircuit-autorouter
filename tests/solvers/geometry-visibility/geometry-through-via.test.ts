import { expect, test } from "bun:test"
import { GeometryAutoroutingPipelineSolver } from "lib/testing/GeometryAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("layer changes escape the actual terminal pads and preserve via drills", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -4, maxY: 4 }, layerCount: 2, minTraceWidth: 0.2, minViaPadDiameter: 0.5, minViaHoleDiameter: 0.25,
    obstacles: [
      { type: "rect", center: { x: -2, y: 0 }, width: 1, height: 1, layers: ["top"], connectedTo: ["signal", "a"] },
      { type: "rect", center: { x: 2, y: 0 }, width: 1, height: 1, layers: ["bottom"], connectedTo: ["signal", "b"] },
    ],
    connections: [{ name: "signal", nominalTraceWidth: 0.25, pointsToConnect: [{ x: -2, y: 0, layer: "top", pcb_port_id: "a" }, { x: 2, y: 0, layer: "bottom", pcb_port_id: "b" }] }],
  }
  const solver = new GeometryAutoroutingPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  const vias = solver.traces.flatMap((t) => t.route.filter((p) => p.route_type === "via"))
  expect(vias.length).toBe(1)
  expect(vias[0].via_diameter).toBe(0.5)
  expect(vias[0].via_hole_diameter).toBe(0.25)
  expect(solver.stats.pipeline9StagesExecuted).toBe(0)
})
