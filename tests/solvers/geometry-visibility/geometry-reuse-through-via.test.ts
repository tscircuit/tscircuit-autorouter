import { expect, test } from "bun:test"
import { GeometryAutoroutingPipelineSolver } from "lib/testing/GeometryAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("later same-net branches reuse legal through vias rather than creating nearby drills", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -4, maxY: 4 }, layerCount: 2, minTraceWidth: 0.1,
    minViaPadDiameter: 0.3, minViaHoleDiameter: 0.15,
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 8, layers: ["top"], connectedTo: [] }],
    connections: [0, 0.1].map((y, i) => ({ name: `branch${i}`, __rootConnectionNames: ["shared"], pointsToConnect: [{ x: -3, y, layer: "top", pcb_port_id: `a${i}` }, { x: 3, y, layer: "top", pcb_port_id: `b${i}` }] })),
  }
  const solver = new GeometryAutoroutingPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  const uniqueVias = new Set(solver.traces.flatMap((trace) => trace.route.filter((p) => p.route_type === "via").map((p) => `${p.x},${p.y}`)))
  expect(uniqueVias.size).toBe(2)
  expect(solver.stats.acceptedAgainstOriginalInput).toBe(true)
})
