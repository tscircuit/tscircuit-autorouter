import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { FuturePointIndex } from "lib/solvers/HighDensitySolver/FuturePointIndex"

type Point = { x: number; y: number; z: number }

function referenceIndex(
  points: readonly Point[],
  query: Point,
  penalty: number,
): number {
  let closest = -1
  let minimum = Infinity
  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    const score = distance(query, point) + (query.z === point.z ? 0 : penalty)
    if (score < minimum) {
      minimum = score
      closest = index
    }
  }
  return closest
}

test("future-point spatial selection matches the original scan across ties, layers and floating-point extremes", (): void => {
  let seed = 183944
  function randomNumber(): number {
    const multiplier = 1664525
    const increment = 1013904223
    seed = (seed * multiplier + increment) % 4294967296
    return seed / 4294967296
  }
  const specialSets: Point[][] = [
    [],
    [{ x: 0, y: 0, z: 0 }],
    [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    [
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
    ],
    [
      { x: NaN, y: 0, z: 0 },
      { x: 0, y: NaN, z: 1 },
      { x: 0, y: 0, z: 0 },
    ],
    [
      { x: Infinity, y: 0, z: 0 },
      { x: -Infinity, y: 0, z: 1 },
    ],
    [
      { x: 1e-200, y: -1e-200, z: 0 },
      { x: -1e-200, y: 1e-200, z: 0 },
    ],
    [
      { x: 1e150, y: 1e150, z: 1 },
      { x: -1e150, y: -1e150, z: 0 },
    ],
    [
      { x: 1e308, y: 1e308, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
  ]
  for (let scenario = 0; scenario < 40; scenario++) {
    const points: Point[] = []
    for (let index = 0; index < scenario * 3; index++) {
      points.push({
        x: Math.round((randomNumber() - 0.5) * 1000) / 10,
        y:
          scenario % 5 === 0
            ? 0
            : Math.round((randomNumber() - 0.5) * 1000) / 10,
        z: Math.floor(randomNumber() * 4),
      })
    }
    specialSets.push(points)
  }
  let comparisons = 0
  for (const points of specialSets) {
    for (const point of points) Object.freeze(point)
    Object.freeze(points)
    const index = new FuturePointIndex(points)
    const queries: Point[] = [
      { x: 0, y: 0, z: 0 },
      { x: -0, y: 0, z: 1 },
      { x: 1 - Number.EPSILON, y: 0, z: 2 },
      { x: 1 + Number.EPSILON, y: 0, z: 3 },
      { x: 1e-200, y: 0, z: 0 },
      { x: 1e150, y: -1e150, z: 1 },
      { x: NaN, y: 0, z: 0 },
      { x: Infinity, y: 0, z: 1 },
      { x: -Infinity, y: 0, z: 0 },
      { x: 0, y: 0, z: NaN },
    ]
    for (let query = 0; query < 40; query++) {
      queries.push({
        x: (randomNumber() - 0.5) * 100,
        y: (randomNumber() - 0.5) * 100,
        z: query % 4,
      })
    }
    for (const query of queries) {
      for (const penalty of [0, -0, 0.1, 2, 10, -2, Infinity, -Infinity, NaN]) {
        expect(index.findClosestIndex(query, penalty)).toBe(
          referenceIndex(points, query, penalty),
        )
        comparisons++
      }
    }
  }
  expect(comparisons).toBe(22050)
})
