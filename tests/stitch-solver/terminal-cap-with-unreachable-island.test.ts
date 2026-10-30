import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("a valid terminal cap completes the routed path beside an unreachable island", (): void => {
  const common = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
  }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: 0, y: 0, z: 0, pcb_port_id: "a" },
    end: { x: 5, y: 0, z: 0, pcb_port_id: "b" },
    preserveTerminalPcbPortIds: true,
    stitchClearanceMode: "require_clear",
    isStitchSegmentClear: (): boolean => true,
    hdRoutes: [
      { ...common, route: [{ x: 0, y: 0, z: 0 }, { x: 4.9, y: 0, z: 0 }] },
      { ...common, route: [{ x: 0, y: 3, z: 0 }, { x: 0, y: 3, z: 1 }] },
    ],
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 4.9, y: 0, z: 0 },
    { x: 5, y: 0, z: 0 },
  ])
})
