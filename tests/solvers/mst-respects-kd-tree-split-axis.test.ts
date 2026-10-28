import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("MST neighbor searches follow the KD tree split axis", (): void => {
  const points = Array.from({ length: 100 }, (_, index) => ({
    x: index % 10,
    y: Math.floor(index / 10),
  }))

  const edges = buildMinimumSpanningTree(points)

  expect(edges).toHaveLength(99)
  // Every vertex of this unit grid can join the tree with a unit edge.
  expect(edges.reduce((length, edge) => length + edge.weight, 0)).toBe(99)
  expect(edges.every((edge) => edge.weight === 1)).toBe(true)
})
