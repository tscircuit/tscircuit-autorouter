import { expect, test } from "bun:test"
import {
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type Point = { x: number; y: number; z: number }

function createNode(point: Point, parent: Node | null = null): Node {
  return { ...point, g: 0, f: 0, parent }
}

function adjacentFloat(value: number, direction: -1 | 1): number {
  if (value === 0) return direction * Number.MIN_VALUE
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setFloat64(0, value)
  const bits = view.getBigUint64(0)
  view.setBigUint64(0, bits + BigInt(value > 0 ? direction : -direction))
  return view.getFloat64(0)
}

test("precomputed geometry preserves strict distance boundaries and point memo invalidation", (): void => {
  let seed = 27
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const cases: { a: Point; b: Point; point: Point; parent: Point }[] = []
  for (let index = 0; index < 500; index++) {
    const scale = [1e-120, 0.01, 1, 1e4, 1e120][index % 5]!
    const a = {
      x: (random() - 0.5) * scale,
      y: (random() - 0.5) * scale,
      z: 0,
    }
    const b =
      index % 11 === 0
        ? { ...a }
        : {
            x: (random() - 0.5) * scale,
            y: (random() - 0.5) * scale,
            z: 0,
          }
    const point = {
      x: (random() - 0.5) * scale,
      y: (random() - 0.5) * scale,
      z: 0,
    }
    const parent = {
      x: (random() - 0.5) * scale,
      y: (random() - 0.5) * scale,
      z: 0,
    }
    cases.push({ a, b, point, parent })
  }
  cases.push({
    a: { x: -100.35000000000001, y: -0.1, z: 0 },
    b: { x: -100.35000000000001, y: 0.1, z: 0 },
    point: { x: -100.2, y: 0, z: 0 },
    parent: { x: -100, y: 0, z: 0 },
  })

  for (const { a, b, point, parent } of cases) {
    const obstacle: HighDensityIntraNodeRoute = {
      connectionName: "obstacle",
      traceThickness: 0,
      viaDiameter: 0,
      route: [a, b],
      vias: [],
    }
    const solver = new SingleHighDensityRouteSolver({
      connectionName: "current",
      obstacleRoutes: [obstacle],
      minDistBetweenEnteringPoints: 0.01,
      bounds: { minX: -1e121, minY: -1e121, maxX: 1e121, maxY: 1e121 },
      A: { x: 0, y: 0, z: 0 },
      B: { x: 1, y: 1, z: 0 },
      traceThickness: 0,
      obstacleMargin: 0,
      viaDiameter: 0,
      availableZ: [0],
    })
    const node = createNode(point, createNode(parent))
    const pointDistance = pointToSegmentDistance(point, a, b)
    const pathDistance = Math.min(
      pointToSegmentDistance(point, a, b),
      pointToSegmentDistance(parent, a, b),
      pointToSegmentDistance(a, point, parent),
      pointToSegmentDistance(b, point, parent),
    )
    for (const radius of [
      adjacentFloat(pointDistance, -1),
      pointDistance,
      adjacentFloat(pointDistance, 1),
    ]) {
      const overlapsPointBounds = !(
        point.x + radius < Math.min(a.x, b.x) ||
        point.y + radius < Math.min(a.y, b.y) ||
        point.x - radius > Math.max(a.x, b.x) ||
        point.y - radius > Math.max(a.y, b.y)
      )
      expect(solver.isNodeTooCloseToObstacle(node, radius, false)).toBe(
        overlapsPointBounds && pointDistance < radius,
      )
    }
    for (const clearance of [
      adjacentFloat(pathDistance, -1),
      pathDistance,
      adjacentFloat(pathDistance, 1),
    ]) {
      solver.NEARBY_SEGMENT_CLEARANCE = clearance
      const overlapsPathBounds = !(
        Math.max(point.x, parent.x) + clearance < Math.min(a.x, b.x) ||
        Math.max(point.y, parent.y) + clearance < Math.min(a.y, b.y) ||
        Math.min(point.x, parent.x) - clearance > Math.max(a.x, b.x) ||
        Math.min(point.y, parent.y) - clearance > Math.max(a.y, b.y)
      )
      expect(solver.doesPathToParentIntersectObstacle(node)).toBe(
        overlapsPathBounds &&
          (doSegmentsIntersect(point, parent, a, b) ||
            (clearance > 0 && pathDistance < clearance)),
      )
    }
  }

  const solver = new SingleHighDensityRouteSolver({
    connectionName: "memo",
    obstacleRoutes: [
      {
        connectionName: "via-only",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [],
        vias: [{ x: 0, y: 0 }],
      },
    ],
    minDistBetweenEnteringPoints: 0.01,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    A: { x: -1, y: -1, z: 0 },
    B: { x: 1, y: 1, z: 0 },
    availableZ: [0],
  })
  const freeNode = createNode({ x: 0.55, y: 0, z: 0 })
  const viaIndex = solver.obstacleViaIndex!
  const search = viaIndex.search.bind(viaIndex)
  let searches = 0
  viaIndex.search = (...args: Parameters<typeof search>): number[] => {
    searches++
    return search(...args)
  }
  expect(solver.isNodeTooCloseToObstacle(freeNode)).toBe(false)
  expect(
    solver.isNodeTooCloseToObstacle({
      ...freeNode,
      parent: createNode({ x: 1, y: 0, z: 0 }),
    }),
  ).toBe(false)
  expect(searches).toBe(1)
  solver.viaDiameter = 1
  expect(solver.isNodeTooCloseToObstacle(freeNode)).toBe(true)
  solver.viaDiameter = 0.3
  expect(solver.isNodeTooCloseToObstacle(freeNode)).toBe(false)
  solver.traceThickness = 0.6
  expect(solver.isNodeTooCloseToObstacle(freeNode)).toBe(true)
  solver.traceThickness = 0.15
  expect(solver.isNodeTooCloseToObstacle(freeNode)).toBe(false)
  solver.obstacleMargin = 0.35
  expect(solver.isNodeTooCloseToObstacle(freeNode)).toBe(true)
  solver.obstacleMargin = 0.15
  expect(solver.isNodeTooCloseToObstacle(freeNode, 0.4)).toBe(true)
  const radiusGuardNode = createNode({ x: 0.4, y: 0, z: 0 })
  expect(solver.isNodeTooCloseToObstacle(radiusGuardNode)).toBe(false)
  solver.traceThickness = 0
  solver.obstacleMargin = 0.3
  expect(solver.isNodeTooCloseToObstacle(radiusGuardNode)).toBe(true)
  solver.traceThickness = 0.15
  solver.obstacleMargin = 0.15
  const sameKeyFree = createNode({ x: 0.36, y: 0.115, z: 0 })
  const sameKeyBlocked = createNode({ x: 0.36, y: 0.08, z: 0 })
  expect(solver.getNodeKey(sameKeyFree)).toBe(solver.getNodeKey(sameKeyBlocked))
  expect(solver.isNodeTooCloseToObstacle(sameKeyFree)).toBe(false)
  expect(solver.isNodeTooCloseToObstacle(sameKeyBlocked)).toBe(true)
  expect(solver.isNodeTooCloseToObstacle(freeNode)).toBe(false)
  solver.obstacleRoutes[0]!.vias.push({ x: freeNode.x, y: freeNode.y })
  solver.buildObstacleIndexes()
  expect(solver.isNodeTooCloseToObstacle(freeNode)).toBe(true)
})
