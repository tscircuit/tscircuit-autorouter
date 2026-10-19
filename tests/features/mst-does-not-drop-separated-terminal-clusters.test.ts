import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "../../lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("MST connects separated terminal clusters rather than silently returning a forest", () => {
  const points = [0, 100].flatMap((offset) =>
    Array.from({ length: 11 }, (_, index) => ({
      x: offset + index / 10,
      y: 0,
      pointId: `${offset}-${index}`,
    })),
  )

  const edges = buildMinimumSpanningTree(points)

  expect(edges).toHaveLength(points.length - 1)
  expect(edges.some((edge) => Math.abs(edge.from.x - edge.to.x) > 1)).toBe(true)
})
