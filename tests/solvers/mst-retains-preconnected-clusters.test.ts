import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("honor preconnections and coincident terminals", (): void => {
  const clusters = [0, 100, 200].map((offset) =>
    Array.from({ length: 11 }, (_, index) => ({
      x: offset + index / 10,
      y: 0,
      pointId: `${offset}-${index}`,
    })),
  )
  const points = [
    ...clusters.flat(),
    { ...clusters[0]![0]!, pointId: "same-xy" },
  ]
  const preconnection = {
    from: clusters[0]![0]!,
    to: clusters[2]![0]!,
    weight: 0,
  }
  const edges = buildMinimumSpanningTree(points, {
    extraEdges: [preconnection],
  })

  expect(edges).toHaveLength(points.length - 2)
  expect(edges).toContain(preconnection)
  expect(
    edges.filter((edge): boolean => edge.weight > 1).map((edge): number => edge.weight),
  ).toEqual([99])
  expect(edges.reduce((sum, edge): number => sum + edge.weight, 0)).toBeCloseTo(102)
  expect(edges.every((edge) => points.includes(edge.from))).toBe(true)
  expect(edges.every((edge) => points.includes(edge.to))).toBe(true)
})
