import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("early rejection uses strict final-segment clearance configured before search", () => {
  for (const clearance of [0, 0.25, 0.25001]) {
    const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
      connectionName: "target",
      A: { x: 1, y: 1, z: 0 },
      B: { x: 8, y: 8, z: 0 },
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      minDistBetweenEnteringPoints: 0.1,
      captureSearchDebug: false,
      obstacleRoutes: [{
        connectionName: "obstacle",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [{ x: 7, y: 8.25, z: 0 }, { x: 9, y: 8.25, z: 0 }],
        vias: [],
      }],
      nearbySegmentClearance: 0.5,
    })
    solver.NEARBY_SEGMENT_CLEARANCE = clearance
    solver.step()
    expect(solver.failed).toBe(clearance > 0.25)
    expect(solver.exploredNodes.size).toBe(clearance > 0.25 ? 0 : 1)
  }
})
