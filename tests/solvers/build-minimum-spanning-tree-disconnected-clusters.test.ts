import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "../../lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("spans spatial clusters larger than the nearest-neighbor window", () => {
  const points = [
    ...Array.from({ length: 12 }, (_, index) => ({
      x: index * 0.1,
      y: 0,
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      x: 100 + index * 0.1,
      y: 0,
    })),
  ]

  const edges = buildMinimumSpanningTree(points)
  const reached = new Set([points[0]])
  let changed = true
  while (changed) {
    changed = false
    for (const edge of edges) {
      if (reached.has(edge.from) && !reached.has(edge.to)) {
        reached.add(edge.to)
        changed = true
      } else if (reached.has(edge.to) && !reached.has(edge.from)) {
        reached.add(edge.from)
        changed = true
      }
    }
  }

  expect(edges).toHaveLength(points.length - 1)
  expect(reached.size).toBe(points.length)
})
