import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GlobalLayerAssignmentSolver } from "lib/solvers/GlobalLayerAssignmentSolver/GlobalLayerAssignmentSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("preserves separation from fixed preloaded traces", () => {
  const routedTrace: HighDensityRoute = {
    connectionName: "routed",
    rootConnectionName: "routed",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ],
  }
  const fixedTrace: HighDensityRoute = {
    connectionName: "fixed",
    rootConnectionName: "fixed",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    vias: [],
  }
  const solver = new GlobalLayerAssignmentSolver({
    hdRoutes: [routedTrace],
    fixedHdRoutes: [fixedTrace],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["routed"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["routed"],
      },
    ],
    connMap: new ConnectivityMap({}),
    layerCount: 2,
  })

  solver.solve()

  expect(solver.getOutput()[0]!.vias).toHaveLength(2)
  expect(solver.getOutput()[0]!.route[2]!.z).toBe(1)
  expect(solver.stats.viasRemoved).toBe(0)
})
