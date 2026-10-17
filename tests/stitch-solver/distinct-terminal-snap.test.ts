import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("does not snap two route island endpoints to the same PCB terminal", (): void => {
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
        traceThickness: 0.15,
        viaDiameter: 0.6,
        route: [
          { x: 0.1, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  const terminalIds = [route.startPcbPortId, route.endPcbPortId].filter(
    (pcbPortId): pcbPortId is string => pcbPortId !== undefined,
  )
  expect(terminalIds).toEqual(["pcb_port_start"])
})
