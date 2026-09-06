import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { StitchSegment } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("reaching an existing terminal via requires a clear planar approach on the fragment layer", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "approach-net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 0, z: 1 },
      { x: 1.5, y: 0, z: 1 },
    ],
    vias: [
      { x: 0.5, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const inputSnapshot = structuredClone(route)
  for (const isClear of [true, false]) {
    const checkedSegments: StitchSegment[] = []
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: route.connectionName,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 2, y: 0, z: 0 },
      hdRoutes: [route],
      isStitchSegmentClear: (segment): boolean => {
        checkedSegments.push(structuredClone(segment))
        return isClear
      },
      stitchClearanceMode: "prefer_clear",
    })
    solver.solve()

    expect(solver.solved).toBe(isClear)
    expect(solver.failed).toBe(!isClear)
    expect(checkedSegments).toEqual([
      {
        connectionName: route.connectionName,
        start: { x: 1.5, y: 0, z: 1 },
        end: { x: 2, y: 0, z: 1 },
        traceThickness: 0.15,
      },
    ])
    expect(solver.mergedHdRoute.vias).toEqual(route.vias)
    expect(route).toEqual(inputSnapshot)
    if (isClear) {
      expect(solver.mergedHdRoute.route.slice(-2)).toEqual([
        { x: 2, y: 0, z: 1 },
        { x: 2, y: 0, z: 0 },
      ])
    } else {
      expect(solver.error).toContain("violates copper clearance")
      expect(solver.mergedHdRoute.route).toEqual(route.route)
    }
  }
})
