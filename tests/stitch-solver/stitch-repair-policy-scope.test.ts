import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

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

test("DRC repair permission stays scoped to paths that need it", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "conn",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
    hdRoutes: [makeRoute(0, 1.2), makeRoute(1.4, 2), makeRoute(5, 6)],
    layerCount: 2,
    stitchRepairPolicy: "allow_drc_repair",
  })

  expect(solver.unsolvedRoutes).toHaveLength(1)
  expect(solver.unsolvedRoutes[0]?.stitchRepairPolicy).toBe("validated_only")
})
