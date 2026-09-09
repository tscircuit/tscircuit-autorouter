import { expect, test } from "bun:test"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching supports an explicitly authorized coincident layer transition", (): void => {
  const firstRoute: HighDensityIntraNodeRoute = {
    connectionName: "authorized_transition",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const secondRoute: HighDensityIntraNodeRoute = {
    connectionName: "authorized_transition",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [],
  }

  for (const route of [secondRoute.route, [...secondRoute.route].reverse()]) {
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: "authorized_transition",
      hdRoutes: [firstRoute, { ...secondRoute, route }],
      start: { x: -1, y: 0, z: 0 },
      end: { x: 1, y: 0, z: 1 },
      allowedLayerTransitionPointKeys: new Set([getXyPointKey({ x: 0, y: 0 })]),
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.remainingHdRoutes).toHaveLength(0)
    expect(solver.mergedHdRoute.route).toEqual([
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ])
    expect(solver.mergedHdRoute.vias).toEqual([{ x: 0, y: 0 }])
  }
})
