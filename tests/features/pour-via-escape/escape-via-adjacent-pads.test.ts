import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "lib/types"

test("adjacent pads on one connection share a clear through-hole escape", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.2,
    minViaDiameter: 0.45,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.28,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["ground"],
      },
      {
        type: "rect",
        center: { x: 0.7, y: 0 },
        width: 0.28,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["ground"],
      },
      {
        type: "rect",
        center: { x: -0.5, y: 0 },
        width: 0.28,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["signal"],
      },
      {
        type: "rect",
        center: { x: 1.2, y: 0 },
        width: 0.28,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["signal"],
      },
      {
        type: "rect",
        center: { x: 0.25, y: -0.625 },
        width: 2,
        height: 0.25,
        layers: ["top"],
        connectedTo: ["signal"],
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        layers: ["inner1"],
        connectedTo: ["ground"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "ground",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 0.7, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const solver = new EscapeViaLocationSolver(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getEscapeViaMetadataByPointId().size).toBe(1)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.connections[0]!.pointsToConnect).toHaveLength(3)
  expect(output.obstacles.slice(srj.obstacles.length)[0]!.layers).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])
})
