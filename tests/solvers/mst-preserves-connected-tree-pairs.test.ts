import { expect, test } from "bun:test"
import {
  buildMinimumSpanningTree,
  DisjointSet,
} from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Terminal = { x: number; y: number; pointId: number }

test("connect a unit grid using only its nearest neighbors", (): void => {
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
    expect(Math.hypot(edge.from.x - edge.to.x, edge.from.y - edge.to.y)).toBe(1)
    expect(connected.union(edge.from, edge.to)).toBe(true)
  }
  expect(connected.componentCount).toBe(1)
})
