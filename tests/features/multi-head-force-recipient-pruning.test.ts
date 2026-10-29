import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { isDeepStrictEqual } from "node:util"
import { Frozen142EndpointForceSolver } from "tests/fixtures/Frozen142EndpointForceSolver"

test("fixed endpoint interactions skip unused forces and refresh recipients on later passes", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "force-recipient-pruning",
      center: { x: 0, y: 0 },
      width: 8,
      height: 8,
      availableZ: [0, 1, 2, 3],
      portPoints: [],
    },
    viaDiameter: 0.3,
  }
  const actual = new MultiHeadPolyLineIntraNodeSolver2(params)
  const reference = new Frozen142EndpointForceSolver(params)
  const lines: PolyLine2[] = [0, 0.2].map(
    (y, index): PolyLine2 => ({
      connectionName: `parallel-${index}`,
      start: { x: -2, y, z1: 0, z2: 0 },
      end: { x: 2, y, z1: 0, z2: 0 },
      mPoints: [],
    }),
  )
  const expected = structuredClone(lines)
  const originalExp = Math.exp
  let exponentialCalls = 0
  try {
    Math.exp = (value: number): number => {
      exponentialCalls++
      return originalExp(value)
    }
    const expectedResult = reference.applyForcesToPolyLines(expected)
    expect(exponentialCalls).toBe(4)
    exponentialCalls = 0
    expect(actual.applyForcesToPolyLines(lines)).toEqual(expectedResult)
    expect(exponentialCalls).toBe(0)
  } finally {
    Math.exp = originalExp
  }
  expect(isDeepStrictEqual(lines, expected)).toBe(true)

  for (const candidate of [lines, expected]) {
    candidate[0]!.mPoints = [{ x: 0, y: 0.1, z1: 0, z2: 0 }]
  }
  // Fixed endpoints must still push movable points on the opposite line.
  expect(actual.applyForcesToPolyLines(lines)).toEqual(
    reference.applyForcesToPolyLines(expected),
  )
  expect(isDeepStrictEqual(lines, expected)).toBe(true)

  // Reuse the same workspace after making formerly fixed-only lines movable.
  // Via pairs cover disjoint layers, a shared layer, signed zero, and NaN's
  // SameValueZero match without changing the order of force accumulation.
  for (const layer of [2, 1, -0, NaN]) {
    for (const candidate of [lines, expected]) {
      candidate[0]!.mPoints = [
        { x: -0.3, y: 0.1, z1: Number.isNaN(layer) ? NaN : 0, z2: 1 },
      ]
      candidate[1]!.mPoints = [
        { x: 0.3, y: 0.25, z1: layer, z2: 3 },
      ]
    }
    for (let pass = 0; pass < 3; pass++) {
      expect(
        isDeepStrictEqual(
          actual.applyForcesToPolyLines(lines),
          reference.applyForcesToPolyLines(expected),
        ),
      ).toBe(true)
      expect(isDeepStrictEqual(lines, expected)).toBe(true)
    }
    // Return to fixed-only segments, then grow again on the next iteration.
    for (const candidate of [lines, expected]) {
      for (const line of candidate) line.mPoints.length = 0
    }
    expect(actual.applyForcesToPolyLines(lines)).toEqual(
      reference.applyForcesToPolyLines(expected),
    )
    expect(isDeepStrictEqual(lines, expected)).toBe(true)
  }
})
