import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("a terminal cap cannot connect a bottom pad on the top layer", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: 0, y: 0, z: 1, pcb_port_id: "pad-a" },
    end: { x: 2, y: 0, z: 1, pcb_port_id: "pad-b" },
    preserveTerminalPcbPortIds: true, enableCompleteTerminalStitching: true,
    stitchClearanceMode: "require_clear", isStitchSegmentClear: () => true,
    hdRoutes: [{
      connectionName: "signal", startPcbPortId: "pad-a",
      traceThickness: 0.1524, viaDiameter: 0.2032,
      route: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }],
      vias: [{ x: 1, y: 0 }],
    }],
  })
  solver.solve()
  expect(solver.mergedHdRoute.route.at(-1)).toEqual({ x: 1, y: 0, z: 0 })
  expect(solver.mergedHdRoute.endPcbPortId).toBeUndefined()
})
