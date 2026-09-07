import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("V6 routes a legal detour around a mid-edge via while preserving boundary terminals", (): void => {
  const obstacle: HighDensityIntraNodeRoute = {
    connectionName: "foreign",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -2.8, y: 4, z: 0 },
      { x: -2.8, y: 0.3, z: 0 },
      { x: -2.8, y: 0.3, z: 1 },
      { x: -2.8, y: -4, z: 1 },
    ],
    vias: [{ x: -2.8, y: 0.3 }],
  }
  const originalObstacle = structuredClone(obstacle)
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "signal",
    obstacleRoutes: [obstacle],
    minDistBetweenEnteringPoints: 4,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    A: { x: -4, y: 0, z: 0 },
    B: { x: 4, y: 0, z: 0 },
    traceThickness: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    layerCount: 2,
    availableZ: [0],
    captureSearchDebug: false,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const result = solver.solvedPath
  if (!result) throw new Error("Solved V6 fixture requires its routed output")
  expect(result.route[0]).toMatchObject(solver.A)
  expect(result.route.at(-1)).toMatchObject(solver.B)
  expect(result.vias).toHaveLength(0)
  expect(result.route.some((point): boolean => point.y !== 0)).toBe(true)
  const minimumCenterlineDistance =
    result.traceThickness / 2 + obstacle.viaDiameter / 2 + solver.obstacleMargin
  for (let index = 0; index < result.route.length - 1; index++) {
    const start = result.route[index]!
    const end = result.route[index + 1]!
    expect(start.z).toBe(0)
    expect(end.z).toBe(0)
    expect(
      pointToSegmentDistance(obstacle.vias[0]!, start, end),
    ).toBeGreaterThanOrEqual(minimumCenterlineDistance)
  }
  expect(obstacle).toEqual(originalObstacle)
})
