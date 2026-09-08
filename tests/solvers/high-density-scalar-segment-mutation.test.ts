import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("scalar obstacle clearance preserves public segment edits, custom queries, margins and rebuilt indexes", () => {
  const options = {
    connectionName: "route",
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: -1, z: 0 },
    B: { x: 2, y: -1, z: 0 },
    obstacleRoutes: [
      {
        connectionName: "obstacle",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        vias: [],
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
    ],
  }
  const solver = new SingleHighDensityRouteSolver(options)
  const node: Node = { x: 0, y: 0.3, z: 0, f: 0, g: 0, h: 0, parent: null }
  const segment = solver.obstacleSegments[0]!
  const query = { segments: [segment], segmentIds: [0] }
  // Let the custom query cover its mutable endpoints, independently of old index bounds.
  segment.minX = segment.minY = -Infinity
  segment.maxX = segment.maxY = Infinity
  for (const endpointY of [
    0,
    Number.EPSILON,
    -Number.EPSILON,
    0.3,
    0.4,
    NaN,
  ]) {
    segment.A.y = endpointY
    segment.B = { x: 1, y: endpointY, z: 0 }
    for (const margin of [0.15, 0, -0.15, -1, Infinity, NaN]) {
      const expected =
        pointToSegmentDistance(node, segment.A, segment.B) <
        solver.traceThickness + margin
      expect(
        solver.isNodeTooCloseToObstacle(node, margin, false, query),
      ).toBe(expected)
    }
  }
  segment.connectedToCurrentConnection = true
  expect(solver.isNodeTooCloseToObstacle(node, Infinity, false, query)).toBe(
    false,
  )
  segment.connectedToCurrentConnection = false
  segment.A = { x: -1, y: 0.3, z: 0 }
  segment.B = { x: 1, y: 0.3, z: 0 }
  expect(solver.isNodeTooCloseToObstacle(node, undefined, false, query)).toBe(
    true,
  )
  query.segmentIds = []
  expect(solver.isNodeTooCloseToObstacle(node, undefined, false, query)).toBe(
    false,
  )

  options.obstacleRoutes[0]!.route = [
    { x: -1, y: 0.3, z: 0 },
    { x: 1, y: 0.3, z: 0 },
  ]
  solver.buildObstacleIndexes()
  let calls = 0
  const index = solver.obstacleSegmentIndexByLayer.get(0)!
  const search = index.search.bind(index)
  index.search = (...args: Parameters<typeof search>): number[] => {
    calls++
    return search(...args)
  }
  expect(solver.isNodeTooCloseToObstacle(node)).toBe(true)
  expect(calls).toBe(1)
})
