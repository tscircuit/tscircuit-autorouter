import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("stitching keeps distinct terminal identities when an island is near one port", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_start",
          },
          {
            x: 1.3,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_end",
          },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        route: [
          { x: 0.05, y: 0, z: 0 },
          { x: 0.1, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
    layerCount: 2,
    defaultViaDiameter: 0.45,
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]).toMatchObject({
    startPcbPortId: "pcb_port_start",
    endPcbPortId: "pcb_port_end",
  })
})
