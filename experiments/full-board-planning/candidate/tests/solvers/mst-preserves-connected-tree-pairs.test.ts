import { expect, test } from "bun:test"
import {
  buildMinimumSpanningTree,
  DisjointSet,
} from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Terminal = { x: number; y: number; pointId: number }

test("find the minimum tree across both KD split axes", (): void => {
  const points: Terminal[] = Array.from({ length: 4 }, (_, x): Terminal[] =>
    Array.from(
      { length: 7 },
      (_, y): Terminal => ({
        x,
        y,
        pointId: x * 7 + y,
      }),
    ),
  ).flat()
  const edges = buildMinimumSpanningTree(points)

  const connected = new DisjointSet(points)
  expect(edges).toHaveLength(points.length - 1)
  for (const edge of edges) {
    expect(connected.union(edge.from, edge.to)).toBe(true)
  }
  expect(connected.componentCount).toBe(1)
  // Every distinct grid point is at least one unit apart, and unit edges can
  // connect the entire grid, so 27 is the exact minimum spanning-tree length.
  expect(edges.reduce((total, edge): number => total + edge.weight, 0)).toBe(27)
})
