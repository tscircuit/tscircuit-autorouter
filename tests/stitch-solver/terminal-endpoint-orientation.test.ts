import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("terminal assignment survives small endpoint coordinate differences", (): void => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
          { x: 10, y: 0, layer: "top", pcb_port_id: "end" },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "signal",
        startPcbPortId: "start",
        endPcbPortId: "end",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0.0003, y: 0, z: 0 },
          { x: 10.0004, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  expect(new Set([route.startPcbPortId, route.endPcbPortId])).toEqual(
    new Set(["start", "end"]),
  )
})
