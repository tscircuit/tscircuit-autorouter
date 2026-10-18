import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "../../lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("MST uses nearest unit-grid edges rather than inflating an already connected routing demand", () => {
  const points = Array.from({ length: 4 }, (_, x) =>
    Array.from({ length: 7 }, (_, y) => ({ x, y })),
  ).flat()

  const edges = buildMinimumSpanningTree(points)

  expect(edges).toHaveLength(27)
  expect(edges.reduce((total, edge) => total + edge.weight, 0)).toBe(27)
})
