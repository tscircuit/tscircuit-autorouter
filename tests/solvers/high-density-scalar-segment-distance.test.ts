import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { pointToSegmentDistanceScalar } from "lib/utils/pointToSegmentDistanceScalar"

test("scalar segment distance matches math-utils numerical boundaries and observable coordinate reads", () => {
  type Point = { x: number; y: number }
  const values = [
    0,
    -0,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    1e-160,
    -1e-160,
    1e-150,
    -1e-150,
    1e-12,
    -1e-12,
    0.15,
    0.3,
    1,
    -1,
    1 + Number.EPSILON,
    1 - Number.EPSILON,
    1e150,
    -1e150,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    Infinity,
    -Infinity,
    NaN,
  ]
  let seed = 781991
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const check = (p: Point, v: Point, w: Point): void => {
    const expected = pointToSegmentDistance(p, v, w)
    const actual = pointToSegmentDistanceScalar(p, v, w)
    expect(Object.is(actual, expected)).toBe(true)
    for (const margin of [
      expected,
      expected - Number.EPSILON,
      expected + Number.EPSILON,
      0,
      -0,
      -1,
      Infinity,
      NaN,
    ]) {
      expect(actual < margin).toBe(expected < margin)
    }
  }
  for (const x of values) {
    for (const y of values) {
      check({ x, y }, { x: 0, y: 0 }, { x: 1, y: 1 })
      check({ x: 0.3, y: -0.15 }, { x, y }, { x, y })
      check({ x: 1, y: -1 }, { x, y: 0 }, { x: 0, y })
    }
  }
  for (let i = 0; i < 4096; i++) {
    const point = (): Point => ({
      x: (random() - 0.5) * 10 ** (random() * 320 - 160),
      y: (random() - 0.5) * 10 ** (random() * 320 - 160),
    })
    check(point(), point(), point())
  }

  for (const degenerate of [false, true]) {
    for (const mutable of [false, true]) {
      const run = (
        calculate: typeof pointToSegmentDistance,
      ): { result: number; reads: string[] } => {
        const reads: string[] = []
        let access = 0
        const point = (name: string, x: number, y: number): Point =>
          new Proxy(
            { x, y },
            {
              get(target, key: "x" | "y") {
                reads.push(`${name}.${key}`)
                const value = target[key]
                return mutable ? value + ++access / 1000 : value
              },
            },
          )
        const result = calculate(
          point("p", 0.3, -0.7),
          point("v", 0.1, 0.2),
          point("w", degenerate ? 0.1 : 0.9, degenerate ? 0.2 : 1.1),
        )
        return { result, reads }
      }
      const expected = run(pointToSegmentDistance)
      const actual = run(pointToSegmentDistanceScalar)
      expect(actual.reads).toEqual(expected.reads)
      expect(Object.is(actual.result, expected.result)).toBe(true)
    }
  }
})
