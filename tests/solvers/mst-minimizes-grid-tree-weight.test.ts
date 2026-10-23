import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Point = { x: number; y: number; pointId: number }

test("build a minimum grid tree without mutating terminals", (): void => {
  const points = Array.from({ length: 4 }, (_, x): Point[] =>
    Array.from({ length: 7 }, (_, y): Point => ({ x, y, pointId: x * 7 + y })),
  ).flat()
  Object.freeze(points)
  const edges = buildMinimumSpanningTree(points)
  const connected = new Set([points[0]])
  for (let iteration = 0; iteration < points.length; iteration++) {
    for (const edge of edges) {
      if (connected.has(edge.from) || connected.has(edge.to)) {
        connected.add(edge.from)
        connected.add(edge.to)
      }
    }
  }

  expect(edges).toHaveLength(points.length - 1)
  expect(edges.every((edge): boolean => edge.weight === 1)).toBe(true)
  expect(connected.size).toBe(points.length)
  expect(
    edges.every((edge): boolean => points.includes(edge.from) && points.includes(edge.to)),
  ).toBe(true)
})
