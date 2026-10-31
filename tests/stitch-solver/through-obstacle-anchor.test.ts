import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching preserves exact through-obstacle anchors and reversed edge metadata", () => {
  for (const gap of [0, 0.0005]) {
    const metadata = { pcb_plated_hole_id: "hole1" }
    const routes: HighDensityIntraNodeRoute["route"][] = [
      [{ x: 0, y: 0, z: 1 }, { x: 1 - gap, y: 0, z: 1 }],
      [
        { x: 1, y: 0, z: 3, toNextSegmentType: "through_obstacle", toNextSegmentCircuitJsonMetadata: metadata },
        { x: 1, y: 0, z: 1 },
      ],
      [{ x: 1, y: 0, z: 3 }, { x: 2, y: 0, z: 3 }],
    ]
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: "net1",
      start: { x: 0, y: 0, z: 1 },
      end: { x: 2, y: 0, z: 3 },
      hdRoutes: routes.map((route) => ({ connectionName: "net1", traceThickness: 0.15, viaDiameter: 0.3, route, vias: [] })),
      isStitchSegmentClear: () => true,
      stitchClearanceMode: "require_clear",
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const output = solver.mergedHdRoute.route
    const transition = output.findIndex((point) => point.toNextSegmentType === "through_obstacle")
    expect(transition).toBeGreaterThan(0)
    expect(output[transition]).toEqual({ x: 1, y: 0, z: 1, toNextSegmentType: "through_obstacle", toNextSegmentCircuitJsonMetadata: metadata })
    expect(output[transition + 1]).toEqual({ x: 1, y: 0, z: 3 })
    if (gap > 0) expect(output[transition - 1]).toEqual({ x: 1 - gap, y: 0, z: 1 })
    expect(output.filter((point) => point.toNextSegmentCircuitJsonMetadata)).toHaveLength(1)
  }
})
