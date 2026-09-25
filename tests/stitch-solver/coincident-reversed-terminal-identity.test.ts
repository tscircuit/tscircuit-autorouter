import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("stitching orients coincident terminals using routed PCB identities", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "coincident",
    start: { x: 16, y: 60, z: 0, pcb_port_id: "pcb_port_157" },
    end: { x: 16, y: 60, z: 0, pcb_port_id: "pcb_port_170" },
    hdRoutes: [
      {
        connectionName: "coincident",
        startPcbPortId: "pcb_port_170",
        endPcbPortId: "pcb_port_157",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 16, y: 60, z: 0 },
          { x: 16, y: 60, z: 0 },
        ],
        vias: [],
      },
    ],
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.startPcbPortId).toBe("pcb_port_157")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("pcb_port_170")
  expect(
    solver.mergedHdRoute.route.every(
      (point) => point.x === 16 && point.y === 60 && point.z === 0,
    ),
  ).toBe(true)
})
