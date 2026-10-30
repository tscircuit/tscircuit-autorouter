import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("nearby terminals retain the routed fragment instead of a terminal shortcut", (): void => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 1, y: 0, z: 0 },
  ]
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { ...points[0]!, pcb_port_id: "a" },
    end: { ...points.at(-1)!, pcb_port_id: "b" },
    preserveTerminalPcbPortIds: true,
    stitchClearanceMode: "prefer_clear",
    isStitchSegmentClear: ({ start, end }): boolean =>
      !(start.y === 0 && end.y === 0 && start.x !== end.x),
    hdRoutes: [{
      connectionName: "signal",
      startPcbPortId: "a",
      endPcbPortId: "b",
      route: points,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
    }],
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual(points)
  expect(solver.remainingHdRoutes).toHaveLength(0)
})
