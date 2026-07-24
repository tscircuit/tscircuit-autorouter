import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

const makeRoute = (
  startX: number,
  endX: number,
): HighDensityIntraNodeRoute => ({
  connectionName: "conn",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
})

test("pipeline DRC handoff preserves topology when no validated stitch exists", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 2, y: 0, z: 0 },
    hdRoutes: [makeRoute(0, 1), makeRoute(1.5, 2)],
    isValidStitchSegment: ({ start, end }) => Math.abs(start.x - end.x) < 0.5,
    stitchRepairPolicy: "allow_drc_repair",
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1.5, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])

  const visualization = solver.visualize()
  expect(new Set(visualization.lines?.map((line) => line.step))).toEqual(
    new Set([1, 2, 3]),
  )
  expect(
    visualization.lines?.some(
      (line) =>
        line.step === 3 && line.label === "Requires downstream DRC repair",
    ),
  ).toBe(true)
})
