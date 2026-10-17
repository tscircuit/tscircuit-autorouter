import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("a tagged terminal starts on its physical layer instead of a coincident stub", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: 0, y: 0, z: 1, pcb_port_id: "pad-a" },
    end: { x: 1, y: 0, z: 1, pcb_port_id: "pad-b" },
    preserveTerminalPcbPortIds: true,
    enableCompleteTerminalStitching: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.1524,
        viaDiameter: 0.2032,
        vias: [],
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0.01, y: 0, z: 0 },
        ],
      },
      {
        connectionName: "signal",
        traceThickness: 0.1524,
        viaDiameter: 0.2032,
        vias: [],
        startPcbPortId: "pad-a",
        endPcbPortId: "pad-b",
        route: [
          { x: 0, y: 0, z: 1 },
          { x: 1, y: 0, z: 1 },
        ],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.mergedHdRoute.route[0]).toEqual({ x: 0, y: 0, z: 1 })
  expect(solver.mergedHdRoute.route.at(-1)).toEqual({ x: 1, y: 0, z: 1 })
  expect(solver.mergedHdRoute.startPcbPortId).toBe("pad-a")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("pad-b")
})
