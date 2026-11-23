import { expect, test } from "bun:test"
import { BoundedConnectionSolver } from "lib/solvers/BoundedConnectionSolver/BoundedConnectionSolver"
import type { SimpleRouteJson } from "lib/types"

test("a bounded two-pin connection routes on its declared layer around foreign copper", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    bounds: { minX: -4, minY: -3, maxX: 4, maxY: 3 },
    minTraceWidth: 0.2,
    obstacles: [
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["power"],
      },
    ],
    connections: [
      {
        name: "clock",
        maxLength: 5.5,
        maxViaCount: 0,
        pointsToConnect: [
          { pointId: "a", x: -2, y: 0, layer: "bottom" },
          { pointId: "b", x: 2, y: 0, layer: "bottom" },
        ],
      },
    ],
  }
  const solver = new BoundedConnectionSolver(input, [])
  solver.solve()
  expect(solver.solved).toBe(true)
  const [trace] = solver.traces
  expect(trace!.connectsTo).toEqual(["a", "b"])
  const route = trace!.route.filter(
    (p) => p.route_type === "wire" && p.layer === "bottom",
  )
  expect(route).toHaveLength(trace!.route.length)
  let length = 0
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!,
      b = route[i]!
    if (a.route_type !== "wire" || b.route_type !== "wire")
      throw new Error("expected wires")
    length += Math.hypot(a.x - b.x, a.y - b.y)
  }
  expect(length).toBeGreaterThan(4)
  expect(length).toBeLessThanOrEqual(5.5)
  expect(solver.getRoutingInput(input).connections).toHaveLength(0)
  expect(input.connections).toHaveLength(1)
})
