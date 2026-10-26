import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("an internal island does not snap to terminals declared on other layers", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [{ name: "signal", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "top" },
      { x: 2, y: 0, layer: "bottom", pcb_port_id: "bottom" },
    ] }],
    hdRoutes: [{
      connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: 0.1, y: 0, z: 3 }, { x: 0.1, y: 0, z: 4 }],
      vias: [{ x: 0.1, y: 0 }],
    }],
    layerCount: 8,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })

  expect(solver.unsolvedRoutes).toHaveLength(1)
  expect(solver.unsolvedRoutes[0].start).toEqual({ x: 0.1, y: 0, z: 3 })
  expect(solver.unsolvedRoutes[0].end).toEqual({ x: 0.1, y: 0, z: 4 })
})
