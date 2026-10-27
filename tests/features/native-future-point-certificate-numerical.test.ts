import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"

type Point = { x: number; y: number; z: number }

const createSolver = (points: Point[]): Native => {
  return new Native({
    connectionName: "active",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -1, y: -1, z: 0 },
    B: { x: 1, y: 1, z: 1 },
    futureConnections: [{ connectionName: "future", points }],
    layerCount: 6,
    captureSearchDebug: false,
    useFuturePointCertificates: true,
  })
}

const fullScan = (solver: Native, node: Node): Point | null => {
  let result: Point | null = null
  let best = Infinity
  for (const point of solver.futureConnectionPoints) {
    const dx = node.x - point.x
    const dy = node.y - point.y
    const score =
      Math.sqrt(dx * dx + dy * dy) +
      (node.z !== point.z ? solver.viaPenaltyDistance : 0)
    if (score < best) {
      best = score
      result = point
    }
  }
  return result
}

test("certified nearest points match numeric and tie oracles", () => {
  let seed = 917329
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  let comparisons = 0
  for (let scene = 0; scene < 120; scene++) {
    const scale = [1, 2 ** 20, 2 ** -500, Number.MIN_VALUE][scene % 4]!
    const points: Point[] = []
    for (let index = 0; index < scene % 37; index++) {
      points.push({
        x: (random() * 2 - 1) * scale,
        y: (random() * 2 - 1) * scale,
        z: index % 6,
      })
    }
    if (points.length > 2 && scene % 3 === 0) {
      points[1] = { ...points[0]! }
      points[2] = { x: -points[0]!.x, y: points[0]!.y, z: points[0]!.z }
    }
    const solver = createSolver(points)
    for (let index = 0; index < 700; index++) {
      const node: Node = {
        x: Math.max(-scale, Math.min(scale, (random() - 0.5) * scale)),
        y: Math.max(-scale, Math.min(scale, (random() - 0.5) * scale)),
        z: index % 6,
        g: 0,
        h: 0,
        f: 0,
        parent: null,
      }
      expect(solver.getClosestFutureConnectionPoint(node)).toBe(
        fullScan(solver, node),
      )
      comparisons++
    }
  }
  const tieSolver = createSolver([
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
  ])
  for (const x of [-Number.EPSILON, -0, 0, Number.MIN_VALUE, Number.EPSILON]) {
    const node: Node = { x, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
    expect(tieSolver.getClosestFutureConnectionPoint(node)).toBe(
      fullScan(tieSolver, node),
    )
  }
  expect(comparisons).toBe(84_000)
})
