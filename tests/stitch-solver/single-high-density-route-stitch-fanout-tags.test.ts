import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("single stitch accepts fan-out terminal tags", (): void => {
  const terminalFanoutRoutes = [3, 6].map(
    (x): HighDensityIntraNodeRoute => ({
      connectionName: "conn",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x, y: 0, z: 0 },
      ],
      vias: [],
      jumpers: [],
      startPcbPortId: "pcb_port_start",
    }),
  )
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
    end: { x: 10, y: 0, z: 0, pcb_port_id: "pcb_port_end" },
    hdRoutes: terminalFanoutRoutes,
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })

  expect(solver.mergedHdRoute.startPcbPortId).toBe("pcb_port_start")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("pcb_port_end")
})
