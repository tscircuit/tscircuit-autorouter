import { distance } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type Point = { x: number; y: number; z: number }

function findReferenceClosestPoint(
  points: readonly Point[],
  node: Node,
  viaPenaltyDistance: number,
): Point | null {
  let minimumDistance = Infinity
  let closestPoint: Point | null = null
  for (const point of points) {
    const candidateDistance =
      distance(node, point) + (node.z !== point.z ? viaPenaltyDistance : 0)
    if (candidateDistance < minimumDistance) {
      minimumDistance = candidateDistance
      closestPoint = point
    }
  }
  return closestPoint
}

test("indexed future points preserve exact scan winners across ties, scales, layers, and replacements", (): void => {
  let seed = 1729
  const points: Point[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: -1, y: 0, z: 2 },
    { x: Number.MIN_VALUE, y: 0, z: 1 },
    { x: 0, y: Number.MIN_VALUE, z: 2 },
    { x: Number.NaN, y: 0, z: 0 },
    { x: 0, y: Infinity, z: 1 },
    { x: -Infinity, y: 0, z: 2 },
    { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: 0 },
  ]
  for (let index = 0; index < 128; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    points.push({
      x: ((seed % 2001) - 1000) / 97,
      y: ((Math.floor(seed / 2001) % 2001) - 1000) / 97,
      z: seed % 4,
    })
  }
  for (const point of points) Object.freeze(point)
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "current",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -12, maxX: 12, minY: -12, maxY: 12 },
    A: { x: -12, y: -12, z: 0 },
    B: { x: 12, y: 12, z: 0 },
    layerCount: 4,
    futureConnections: [{ connectionName: "future", points }],
    captureSearchDebug: false,
  })
  const queries: Node[] = []
  for (let index = 0; index < 384; index++) {
    queries.push({
      x: ((index % 31) - 15) * solver.cellStep,
      y: ((Math.floor(index / 31) % 29) - 14) * solver.cellStep,
      z: index % 4,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    })
  }
  for (const x of [
    0,
    Number.MIN_VALUE,
    1e-160,
    1e160,
    Number.MAX_VALUE,
    Infinity,
    NaN,
  ]) {
    queries.push({ x, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null })
  }
  for (const penalty of [-Infinity, -2, -0, 0.2, 2, 1e160, Infinity, NaN]) {
    Object.defineProperty(solver, "viaPenaltyDistance", {
      configurable: true,
      get: (): number => penalty,
    })
    for (const query of queries) {
      const expected = findReferenceClosestPoint(points, query, penalty)
      expect(solver.getClosestFutureConnectionPoint(query)).toBe(expected)
      expect(solver.getClosestFutureConnectionPoint({ ...query })).toBe(
        expected,
      )
    }
  }
  const query = queries[0]!
  for (const replacement of [[...points].reverse(), [], points.slice(0, 3)]) {
    solver.futureConnectionPoints = replacement
    expect(solver.getClosestFutureConnectionPoint(query)).toBe(
      findReferenceClosestPoint(replacement, query, solver.viaPenaltyDistance),
    )
  }
  solver.futureConnectionPoints.push(...points)
  expect(solver.getClosestFutureConnectionPoint(query)).toBe(
    findReferenceClosestPoint(
      solver.futureConnectionPoints,
      query,
      solver.viaPenaltyDistance,
    ),
  )
  for (const tiedPoints of [
    [
      { x: 1 + Number.EPSILON, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    [
      { x: 1e-170, y: 0, z: 0 },
      { x: -1e-170, y: 0, z: 0 },
    ],
  ]) {
    const origin = { ...query, x: 0, y: 0, z: 0 }
    solver.futureConnectionPoints = [
      ...tiedPoints,
      ...Array.from(
        { length: 10 },
        (_, index): Point => ({
          x: 100 + index,
          y: 100,
          z: 1,
        }),
      ),
    ]
    Object.defineProperty(solver, "viaPenaltyDistance", {
      configurable: true,
      get: (): number => 1e16,
    })
    expect(solver.getClosestFutureConnectionPoint(origin)).toBe(
      findReferenceClosestPoint(solver.futureConnectionPoints, origin, 1e16),
    )
  }
})
