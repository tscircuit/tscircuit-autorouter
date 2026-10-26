import * as mathUtils from "@tscircuit/math-utils"
import { expect, spyOn, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import {
  futureGeometrySolver,
  referenceFutureTraceQuery,
} from "./futureGeometryTestUtils"

test("future geometry broad phase skips far exact distances and retains near evaluations", (): void => {
  const solver = futureGeometrySolver([])
  solver.futureConnectionSegmentsCache = Array.from({ length: 32 }, (_, index) => ({
    connectionName: `future-${index}`,
    start: { x: 0, y: index * 2, z: 0 },
    end: { x: 1, y: index * 2, z: 1 },
  }))
  const query: Node = { x: 10, y: 0, z: 1, g: 0, h: 0, f: 0, parent: null }
  const exactDistance = spyOn(mathUtils, "pointToSegmentDistance")
  try {
    expect(referenceFutureTraceQuery(solver, query)).toBe(false)
    expect(exactDistance).toHaveBeenCalledTimes(32)
    exactDistance.mockClear()
    expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(false)
    expect(exactDistance).toHaveBeenCalledTimes(0)
    query.x = 0.5
    expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(true)
    expect(exactDistance).toHaveBeenCalledTimes(1)
    const radius = solver.viaDiameter / 2 + solver.traceThickness / 2 + 0.1
    query.y = radius
    exactDistance.mockClear()
    expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(false)
    expect(exactDistance).toHaveBeenCalledTimes(1)
  } finally {
    exactDistance.mockRestore()
  }
})
