import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("empty-fragment stitching uses common declared copper and never invents terminal vias", (): void => {
  for (const shareLayer of [true, false]) {
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: "empty-net",
      start: {
        x: 0,
        y: 0,
        z: 0,
        availableZ: shareLayer ? [0, 1] : [0],
      },
      end: { x: 1, y: 0, z: 1 },
      hdRoutes: [],
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })

    expect(solver.solved).toBe(shareLayer)
    expect(solver.failed).toBe(!shareLayer)
    if (shareLayer) {
      expect(solver.mergedHdRoute.route).toEqual([
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ])
      expect(solver.mergedHdRoute.vias).toEqual([])
    } else {
      expect(solver.error).toContain("requires an existing via")
      expect(solver.mergedHdRoute).toBeUndefined()
    }
  }
})
