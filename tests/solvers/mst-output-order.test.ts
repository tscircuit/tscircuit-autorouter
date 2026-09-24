import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("MST emits stable weight-ordered edges oriented by coordinate order", () => {
  const points = [
    { x: 4, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ]
  const edges = buildMinimumSpanningTree(points)
  expect(edges.map(({ from, to, weight }) => [from.x, to.x, weight])).toEqual([
    [0, 1, 1],
    [1, 2, 1],
    [2, 4, 2],
  ])
  expect(points.map(({ x }) => x)).toEqual([4, 0, 1, 2])
})
