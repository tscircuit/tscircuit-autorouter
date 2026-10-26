import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import {
  futureGeometrySolver,
  referenceFutureTraceQuery,
} from "./futureGeometryTestUtils"

test("future geometry broad phase preserves live endpoints and public scene replacements", (): void => {
  const points = [
    { x: -4, y: 0, z: 0 },
    { x: 4, y: 0, z: 1 },
    { x: 0, y: 4, z: 0 },
  ]
  const solver = futureGeometrySolver(points)
  const query: Node = { x: 0, y: 0, z: 1, g: 0, h: 0, f: 0, parent: null }
  expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(true)
  points[0].y = 8
  points[1].y = 8
  expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(false)
  points[2].x = 0
  points[2].y = 0
  expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(true)
  solver.futureConnectionSegmentsCache = []
  expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(false)
  solver.futureConnections = [{ connectionName: "replacement", points: [
    { x: -2, y: 1, z: 1 },
    { x: 2, y: 1, z: 1 },
  ] }]
  solver.futureConnectionSegmentsCache = null
  expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(false)
  solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 2
  expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(true)
  solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 0.1
  let randomState = 1729
  for (let index = 0; index < 2048; index++) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    query.x = (randomState / 2 ** 32 - 0.5) * 30
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    query.y = (randomState / 2 ** 32 - 0.5) * 30
    query.z = index % 6
    expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(
      referenceFutureTraceQuery(solver, query),
    )
  }
  query.x = 0
  query.y = 0
  query.z = 1
  query.parent = { ...query, z: 0, parent: { ...query, parent: null } }
  solver.futureConnectionSegmentsCache = []
  expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(false)
  expect(solver.isNodeTooCloseToObstacle(query, 0.1, true)).toBe(true)
})
