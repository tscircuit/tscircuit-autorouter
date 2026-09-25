import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("MST uses cheaper extra edges without losing terminal metadata or mutating inputs", () => {
  const points = [
    { x: 0, y: 0, pointId: "a", layer: "top" },
    { x: 10, y: 0, pointId: "b", layer: "bottom" },
    { x: 11, y: 0, pointId: "c", layer: "top" },
    { x: 20, y: 0, pointId: "d", layer: "bottom" },
  ]
  const extraEdges = [
    { from: points[3], to: points[0], weight: 0 },
    { from: points[1], to: points[3], weight: 100 },
    { from: points[2], to: points[1], weight: -2 },
    { from: points[1], to: points[2], weight: 4 },
  ]
  const before = structuredClone({ points, extraEdges })
  const edges = buildMinimumSpanningTree(points, { extraEdges })

  expect(edges).toHaveLength(3)
  expect(edges.reduce((sum, edge) => sum + edge.weight, 0)).toBe(7)
  expect(
    edges.some(
      (edge) =>
        edge.weight === 0 &&
        new Set([edge.from.pointId, edge.to.pointId]).has("d"),
    ),
  ).toBe(true)
  expect({ points, extraEdges }).toEqual(before)
  for (const edge of edges) {
    expect(points.some((point) => point === edge.from)).toBe(true)
    expect(points.some((point) => point === edge.to)).toBe(true)
  }
})
