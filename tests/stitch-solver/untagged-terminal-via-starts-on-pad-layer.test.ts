import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("an untagged via in a bottom pad is oriented from the pad layer", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: 0, y: 0, z: 7, pcb_port_id: "bottom-pad" },
    end: { x: 2, y: 0, z: 0, pcb_port_id: "top-pad" },
    preserveTerminalPcbPortIds: true,
    enableCompleteTerminalStitching: true,
    stitchClearanceMode: "require_clear",
    isStitchSegmentClear: () => true,
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.1524,
        viaDiameter: 0.2032,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 7 },
        ],
        vias: [{ x: 0, y: 0 }],
      },
      {
        connectionName: "signal",
        traceThickness: 0.1524,
        viaDiameter: 0.2032,
        endPcbPortId: "top-pad",
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1.9998, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  solver.solve()
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 7 },
    { x: 0, y: 0, z: 0 },
    { x: 1.9998, y: 0, z: 0 },
  ])
  expect(solver.mergedHdRoute.startPcbPortId).toBe("bottom-pad")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("top-pad")
})
