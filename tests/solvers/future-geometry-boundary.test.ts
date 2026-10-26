import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import {
  futureGeometrySolver,
  referenceFutureTraceQuery,
} from "./futureGeometryTestUtils"

test("future geometry broad phase keeps exact boundary and nonfinite predicate behavior", (): void => {
  const solver = futureGeometrySolver([
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 1 },
  ])
  const query: Node = { x: 2, y: 0, z: 1, g: 0, h: 0, f: 0, parent: null }
  const values = [
    0, Number.MIN_VALUE, 1e-170, 1e-100, 1e-8, 0.325, 1,
    1e8, 1e150, 1e200, Number.MAX_VALUE, Infinity, -Infinity, NaN,
  ]
  for (const scale of values) {
    for (const radius of values) {
      solver.viaDiameter = 0
      solver.traceThickness = 0
      solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = radius
      solver.futureConnectionSegmentsCache = [{
        connectionName: "boundary",
        start: { x: -scale, y: scale, z: 0 },
        end: { x: scale, y: scale, z: 1 },
      }]
      for (const offset of [-1, 0, 1]) {
        query.x = 0
        query.y = scale + radius + offset * Number.EPSILON * Math.max(1, Math.abs(scale))
        expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(
          referenceFutureTraceQuery(solver, query),
        )
      }
    }
  }
  solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 0.325
  for (const x of values) {
    query.x = x
    for (const y of values) {
      query.y = y
      expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(
        referenceFutureTraceQuery(solver, query),
      )
    }
  }
  solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 1e-300
  solver.futureConnectionSegmentsCache = [{
    connectionName: "underflow",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1e-200, y: 1e-200, z: 1 },
  }]
  query.x = 1e-190
  query.y = 0
  expect(referenceFutureTraceQuery(solver, query)).toBe(true)
  expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(true)
})
