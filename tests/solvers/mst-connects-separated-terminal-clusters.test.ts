import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "../../lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("complete separated clusters without replacing local trees", (): void => {
  const clusters = [0, 100, 1000, 1100].map((offset) =>
    Array.from({ length: 11 }, (_, index) => ({
      x: offset + index / 10,
      y: 0,
      pointId: `${offset}-${index}`,
    })),
  )
  const points = clusters.flat()
  const originalOrder = [...points]
  const edges = buildMinimumSpanningTree(points)
  const localEdges = clusters.flatMap((cluster) =>
    buildMinimumSpanningTree(cluster),
  )
  const bridges = edges.filter((edge) => edge.weight > 1)

  expect(edges).toHaveLength(points.length - 1)
  expect(edges.slice(0, localEdges.length)).toEqual(
    localEdges.sort((a, b) => a.weight - b.weight),
  )
  expect(bridges.map((edge) => edge.weight).sort((a, b) => a - b)).toEqual([
    99, 99, 899,
  ])
  expect(points).toEqual(originalOrder)
  for (const edge of edges) {
    expect(points.includes(edge.from)).toBe(true)
    expect(points.includes(edge.to)).toBe(true)
  }
})
