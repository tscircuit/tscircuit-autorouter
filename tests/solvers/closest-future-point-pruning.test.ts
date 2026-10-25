import { distance } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type Point = { x: number; y: number; z: number }

test("nearest future-point queries stop reading distant points after indexing", (): void => {
  let coordinateReads = 0
  const points = Array.from({ length: 512 }, (_, index): Point => ({
    get x(): number {
      coordinateReads++
      return index - 256
    },
    y: 0,
    z: 0,
  }))
  for (const point of points) Object.freeze(point)
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "current",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -260, maxX: 260, minY: -2, maxY: 2 },
    A: { x: -260, y: -2, z: 0 },
    B: { x: 260, y: 2, z: 0 },
    futureConnections: [{ connectionName: "future", points }],
    captureSearchDebug: false,
  })
  const query: Node = {
    x: 0.125,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  let minimumDistance = Infinity
  let expected: Point | null = null
  coordinateReads = 0
  for (const point of points) {
    const candidateDistance = distance(query, point)
    if (candidateDistance < minimumDistance) {
      minimumDistance = candidateDistance
      expected = point
    }
  }
  const fullScanReads = coordinateReads
  solver.getClosestFutureConnectionPoint({ ...query, x: 0.25 })
  coordinateReads = 0
  expect(solver.getClosestFutureConnectionPoint(query)).toBe(expected)
  expect(fullScanReads).toBe(points.length)
  expect(coordinateReads).toBeLessThan(fullScanReads / 4)
})
