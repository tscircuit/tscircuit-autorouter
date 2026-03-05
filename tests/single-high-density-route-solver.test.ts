import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const baseOpts = {
  connectionName: "conn-a",
  minDistBetweenEnteringPoints: 0.2,
  bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
  A: { x: 1, y: 1, z: 0 },
  B: { x: 9, y: 9, z: 0 },
  traceThickness: 0.2,
  obstacleMargin: 0.1,
  layerCount: 2,
}

test("SingleHighDensityRouteSolver indexes obstacle segments and vias", () => {
  const obstacleRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "conn-obstacle",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 2, y: 2, z: 0 },
        { x: 8, y: 2, z: 0 },
      ],
      vias: [{ x: 6, y: 6 }],
    },
  ]

  const solver = new SingleHighDensityRouteSolver({
    ...baseOpts,
    obstacleRoutes,
  })

  expect(solver.obstacleSegments.length).toBe(1)
  expect(solver.obstacleVias.length).toBe(1)

  expect(solver.isNodeTooCloseToObstacle({ x: 5, y: 2.1, z: 0 } as any)).toBe(
    true,
  )
  expect(solver.isNodeTooCloseToObstacle({ x: 6, y: 6.05, z: 1 } as any)).toBe(
    true,
  )
})

test("SingleHighDensityRouteSolver ignores connected obstacle segments for clearance/intersection", () => {
  const obstacleRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "conn-connected",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 3, y: 3, z: 0 },
        { x: 7, y: 3, z: 0 },
      ],
      vias: [],
    },
  ]

  const solver = new SingleHighDensityRouteSolver({
    ...baseOpts,
    obstacleRoutes,
    connMap: {
      areIdsConnected: (a: string, b: string) =>
        (a === "conn-a" && b === "conn-connected") ||
        (a === "conn-connected" && b === "conn-a"),
    } as any,
  })

  expect(solver.isNodeTooCloseToObstacle({ x: 5, y: 3.05, z: 0 } as any)).toBe(
    false,
  )

  const intersectingNode = {
    x: 5,
    y: 4,
    z: 0,
    parent: { x: 5, y: 2, z: 0 },
  }
  expect(
    solver.doesPathToParentIntersectObstacle(intersectingNode as any),
  ).toBe(false)
})
