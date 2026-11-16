import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("connect grid points with unit-length tree edges", (): void => {
  const points = Array.from({ length: 4 }, (_, x) =>
    Array.from({ length: 7 }, (_, y) => ({ x, y })),
  ).flat()
  const edges = buildMinimumSpanningTree(points)

  expect(edges).toHaveLength(points.length - 1)
  for (const { from, to } of edges) {
    expect(Math.hypot(from.x - to.x, from.y - to.y)).toBe(1)
  }
})
