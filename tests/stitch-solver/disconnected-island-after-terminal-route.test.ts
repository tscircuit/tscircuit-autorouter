import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("drops a disconnected island after routing both PCB terminals", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_start" },
          { x: 10, y: 0, layer: "top", pcb_port_id: "pcb_port_end" },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "signal",
        startPcbPortId: "pcb_port_start",
        endPcbPortId: "pcb_port_end",
        traceThickness: 0.15,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "signal",
        traceThickness: 0.15,
        viaDiameter: 0.6,
        route: [
          { x: 5, y: 1, z: 0 },
          { x: 5, y: 1, z: 1 },
        ],
        vias: [{ x: 5, y: 1 }],
      },
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]?.startPcbPortId).toBe("pcb_port_start")
  expect(solver.mergedHdRoutes[0]?.endPcbPortId).toBe("pcb_port_end")
})
