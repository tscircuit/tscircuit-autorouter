import { expect, test } from "bun:test"
import {
  buildMinimumSpanningTree,
  DisjointSet,
} from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Terminal = { x: number; y: number; pointId: string }

test("expand candidate neighborhoods until all clusters connect", (): void => {
  const points: Terminal[] = [0, 100, 1000].flatMap(
    (offset): Terminal[] =>
      Array.from({ length: 25 }, (_, index): Terminal => ({
        x: offset + index / 10,
        y: 0,
        pointId: `${offset}-${index}`,
      })),
  )
  const original = structuredClone(points)
  Object.freeze(points)
  const edges = buildMinimumSpanningTree(points)
  const connected = new DisjointSet(points)

  expect(edges).toHaveLength(points.length - 1)
  for (const edge of edges) {
    expect(connected.union(edge.from, edge.to)).toBe(true)
    expect(points.includes(edge.from)).toBe(true)
    expect(points.includes(edge.to)).toBe(true)
  }
  expect(connected.componentCount).toBe(1)
  expect(points).toEqual(original)
})
