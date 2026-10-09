import { distance } from "@tscircuit/math-utils"
import { expect, spyOn, test } from "bun:test"
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

test("closest future-point memo preserves exact references, ties, layer penalties and key collisions", (): void => {
  const points = [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0.004, y: 0.005, z: 2 },
  ]
  for (const point of points) Object.freeze(point)
  Object.freeze(points)
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "current",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: -2, z: 0 },
    B: { x: 2, y: 2, z: 0 },
    layerCount: 3,
    futureConnections: [{ connectionName: "future", points }],
    captureSearchDebug: false,
  })
  const node: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  const originalPoints = JSON.stringify(solver.futureConnectionPoints)
  const scans = spyOn(solver.futureConnectionPoints, Symbol.iterator)
  try {
    const first = solver.getClosestFutureConnectionPoint(node)
    expect(first).toBe(
      findReferenceClosestPoint(points, node, solver.viaPenaltyDistance),
    )
    expect(solver.getClosestFutureConnectionPoint({ ...node, g: 123 })).toBe(
      first,
    )
    expect(scans).toHaveBeenCalledTimes(1)

    const aliased = { ...node, x: 0.004, y: 0.005 }
    expect(solver.getNodeKey(aliased)).toBe(solver.getNodeKey(node))
    for (const query of [
      aliased,
      node,
      { ...node, z: 1 },
      { ...aliased, z: 2 },
      { ...node, x: -10, y: 10 },
      { ...node, x: Number.POSITIVE_INFINITY },
    ]) {
      const expected = findReferenceClosestPoint(
        points,
        query,
        solver.viaPenaltyDistance,
      )
      expect(solver.getClosestFutureConnectionPoint(query)).toBe(expected)
      expect(solver.getClosestFutureConnectionPoint({ ...query })).toBe(expected)
    }

    solver.VIA_PENALTY_FACTOR = 0
    expect(solver.getClosestFutureConnectionPoint(node)).toBe(points[2])
    solver.VIA_PENALTY_FACTOR = 2
    expect(solver.getClosestFutureConnectionPoint(node)).toBe(points[0])
    expect(solver.getClosestFutureConnectionPoint(node)).toBe(points[0])
    expect(JSON.stringify(solver.futureConnectionPoints)).toBe(originalPoints)

    for (let index = 0; index < 600; index++) {
      const query = { ...node, x: (index - 300) * solver.cellStep }
      expect(solver.getClosestFutureConnectionPoint(query)).toBe(
        findReferenceClosestPoint(points, query, solver.viaPenaltyDistance),
      )
    }
    expect(solver.getClosestFutureConnectionPoint(node)).toBe(points[0])
    expect(scans.mock.calls.length).toBeGreaterThan(600)
  } finally {
    scans.mockRestore()
  }
  solver.futureConnectionPoints = []
  expect(solver.getClosestFutureConnectionPoint(node)).toBeNull()
  solver.futureConnectionPoints = [points[1]]
  expect(solver.getClosestFutureConnectionPoint(node)).toBe(points[1])
})
