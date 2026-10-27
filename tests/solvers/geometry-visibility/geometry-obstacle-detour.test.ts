import { expect, test } from "bun:test"
import { GeometryAutoroutingPipelineSolver } from "lib/testing/GeometryAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("whole-board obstacle events detour a rotated keepout without a raster", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -4, maxY: 4 }, layerCount: 1, minTraceWidth: 0.2, defaultObstacleMargin: 0.15,
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1.2, height: 3, ccwRotationDegrees: 30, layers: ["top"], connectedTo: [] }],
    connections: [{ name: "signal", pointsToConnect: [{ x: -3, y: 0, layer: "top", pcb_port_id: "a" }, { x: 3, y: 0, layer: "top", pcb_port_id: "b" }] }],
  }
  const original = JSON.stringify(input)
  const solver = new GeometryAutoroutingPipelineSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.obstacleEvents).toBeGreaterThan(0)
  expect(solver.stats.acceptedAgainstOriginalInput).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces()[0].route.length).toBeGreaterThan(4)
  expect(JSON.stringify(input)).toBe(original)
})
