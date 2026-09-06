import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("an explicit PCB terminal claim cannot be downgraded to an anonymous opposite-layer boundary", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "claimed-net",
    startPcbPortId: "start-port",
    endPcbPortId: "end-port",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 2.4, y: 0, z: 0 },
    ],
    vias: [{ x: 1, y: 0 }],
  }
  const inputSnapshot = structuredClone(route)
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: route.connectionName,
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pcb_port_id: "start-port" },
          { x: 3, y: 0, layer: "bottom", pcb_port_id: "end-port" },
        ],
      },
    ],
    hdRoutes: [route],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })
  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("terminal layer 1")
  expect(solver.mergedHdRoutes).toEqual([])
  expect(solver.activeSolver!.end).toMatchObject({
    x: 3,
    y: 0,
    z: 1,
    pcb_port_id: "end-port",
  })
  expect(solver.activeSolver!.mergedHdRoute.endPcbPortId).toBe("end-port")
  expect(route).toEqual(inputSnapshot)
})
