import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a distant via does not divert a terminal path into a planar stub", (): void => {
  const hdRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      startPcbPortId: "start",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      endPcbPortId: "end",
      route: [
        { x: 0, y: 0, z: 2 },
        { x: 1, y: 0, z: 2 },
      ],
      vias: [],
    },
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0.1, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 10, y: 10, z: 0 },
        { x: 10, y: 10, z: 2 },
      ],
      vias: [{ x: 10, y: 10 }],
    },
  ]
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    hdRoutes,
    start: { x: -1, y: 0, z: 0, pcb_port_id: "start" },
    end: { x: 1, y: 0, z: 2, pcb_port_id: "end" },
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 2 },
    { x: 1, y: 0, z: 2 },
  ])
})
