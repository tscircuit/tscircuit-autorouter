import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

class SuppliedSegmentsSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  segments: ReturnType<
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost["getFutureConnectionSegments"]
  > = []
  segmentHookCalls = 0

  override getFutureConnectionSegments(): typeof this.segments {
    this.segmentHookCalls++
    const segments = this.segments
    return segments
  }
}

test("future via bounds preserve rounded projections, numeric limits and live custom segments", () => {
  const solver = new SuppliedSegmentsSolver({
    connectionName: "route",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 1 },
  })
  solver.viaDiameter = 0
  solver.traceThickness = 0
  solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 0.1
  const node: Node = {
    x: 0,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const segment = {
    connectionName: "future",
    start: { x: 1e16, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 0 },
  }
  solver.segments = [segment]
  // t=1 interpolates to x=0, outside the raw endpoints' [1, 1e16] box.
  expect(pointToSegmentDistance(node, segment.start, segment.end)).toBe(0)
  expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
  segment.start.x = segment.end.x = 2
  expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(false)
  segment.start.x = segment.end.x = 0
  expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
  expect(solver.segmentHookCalls).toBe(3)

  let seed = 184753
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const value = seed / 0x100000000
    return value
  }
  const scales = [
    0,
    Number.MIN_VALUE,
    1e-200,
    1e-162,
    1e-154,
    1e-100,
    1e-10,
    1,
    1e10,
    1e100,
    1e154,
    1e200,
    1e308,
    Infinity,
    NaN,
  ]
  for (let sample = 0; sample < 5000; sample++) {
    const scale = scales[sample % scales.length]
    segment.start.x = (random() - 0.5) * scale
    segment.start.y = (random() - 0.5) * scale
    segment.end.x = (random() - 0.5) * scale
    segment.end.y = (random() - 0.5) * scale
    node.x = (random() - 0.5) * scale
    node.y = (random() - 0.5) * scale
    const distance = pointToSegmentDistance(node, segment.start, segment.end)
    for (const clearance of [
      distance,
      distance * (1 + Number.EPSILON),
      distance * (1 - Number.EPSILON),
      scale * 0.1,
      Number.MIN_VALUE,
      -0,
      -1,
      Infinity,
      NaN,
    ]) {
      solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = clearance
      expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(
        distance < clearance,
      )
    }
  }
  expect(solver.segmentHookCalls).toBe(45_003)
})
