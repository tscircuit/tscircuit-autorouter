import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("precise stitching consumes the selected owned path order despite a geometrically nearer future fragment", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "ordered",
    start: { x: 0, y: 0, z: 0 }, end: { x: 3, y: 0, z: 0, pcb_port_id: "end" },
    hdRoutes: [
      { connectionName: "ordered", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] },
      { connectionName: "ordered", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: 1.1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [] },
      { connectionName: "ordered", traceThickness: 0.1, viaDiameter: 0.3, endPcbPortId: "end",
        route: [{ x: 1.05, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], vias: [] },
    ],
    preserveExactEndpoints: true, preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true, stitchClearanceMode: "require_clear",
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route.map((point) => point.x)).toEqual([0, 1, 1.1, 2, 1.05, 3])
  expect(solver.remainingHdRoutes).toHaveLength(0)
})
