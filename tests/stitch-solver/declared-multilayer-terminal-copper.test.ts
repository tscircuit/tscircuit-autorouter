import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("declared multilayer terminals retain legal inner-layer copper without adding vias", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "plated-terminal-net",
    startPcbPortId: "start-port",
    endPcbPortId: "end-port",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ],
    vias: [],
  }
  const inputSnapshot = structuredClone(route)
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: route.connectionName,
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layers: ["top", "inner1", "bottom"],
            pcb_port_id: "start-port",
          },
          {
            x: 2,
            y: 0,
            layers: ["top", "inner1", "bottom"],
            pcb_port_id: "end-port",
          },
        ],
      },
    ],
    hdRoutes: [route],
    layerCount: 3,
    allowedLayerTransitionPointKeys: new Set(),
    preserveTerminalPcbPortIds: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]!.route).toEqual(route.route)
  expect(solver.mergedHdRoutes[0]!.vias).toEqual([])
  expect(solver.mergedHdRoutes[0]!.startPcbPortId).toBe("start-port")
  expect(solver.mergedHdRoutes[0]!.endPcbPortId).toBe("end-port")
  expect(route).toEqual(inputSnapshot)
})
