import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("rejects a terminal taper below the connection minimum", () => {
  const requiredWidth = 1.2
  const solver = new TraceWidthSolver({
    connection: [
      {
        name: "motor",
        nominalTraceWidth: requiredWidth,
        minTraceWidth: requiredWidth,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 0, layer: "top" },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "branch",
        rootConnectionName: "motor",
        traceThickness: 0.15,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["motor"],
      },
    ],
    minTraceWidth: 0.15,
    layerCount: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe(
    'Connection "branch" requires at least 1.2mm copper width, but the routed width is 0.6mm',
  )
  expect(solver.getHdRoutesWithWidths()).toEqual([])
})
