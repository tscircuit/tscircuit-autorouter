import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../lib/types"

test("escape vias move outside forbidden copper while retaining the plane connection", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.2,
        connectedTo: ["GND"],
      },
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: 0 },
        width: 8,
        height: 8,
        connectedTo: ["GND"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "GND",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "pad" }],
      },
    ],
  }
  const baseline = new EscapeViaLocationSolver(input)
  baseline.solve()
  const first = baseline
    .getOutputSimpleRouteJson()
    .connections[0].pointsToConnect.find((p) =>
      p.pointId?.startsWith("escape-via:"),
    )!
  expect(first).toBeDefined()
  const solver = new EscapeViaLocationSolver({
    ...input,
    viaKeepouts: [
      {
        shape: "circle",
        center: { x: first.x, y: first.y },
        radius: 0.2,
        layers: ["bottom"],
      },
    ],
  })
  solver.solve()
  const point = solver
    .getOutputSimpleRouteJson()
    .connections[0].pointsToConnect.find((p) =>
      p.pointId?.startsWith("escape-via:"),
    )!
  expect(point).toBeDefined()
  expect(
    Math.hypot(point.x - first.x, point.y - first.y),
  ).toBeGreaterThanOrEqual(0.5 - 1e-9)
})
