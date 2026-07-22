import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("TraceWidthSolver uses original connection provenance for nominal width", () => {
  const solver = new TraceWidthSolver({
    hdRoutes: [
      {
        connectionName: "merged_mst0",
        rootConnectionName: "narrow_original",
        traceThickness: 0.1,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
    connection: [
      {
        name: "merged_mst0",
        __originalSrjConnectionName: "wide_original",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
    originalConnections: [
      {
        name: "wide_original",
        nominalTraceWidth: 0.4,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "narrow_original",
        nominalTraceWidth: 0.2,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
    minTraceWidth: 0.1,
    layerCount: 2,
  })
  solver.solve()

  expect(solver.getHdRoutesWithWidths()[0]?.traceThickness).toBe(0.4)
})
