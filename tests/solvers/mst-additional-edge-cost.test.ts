import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("nearest-neighbor candidates use the same additional cost as the tree", (): void => {
  const points = [
    { x: 0, y: 0, layer: "top" },
    { x: 0.02, y: 0, layer: "top" },
    ...Array.from({ length: 12 }, (_, index) => ({
      x: (index + 1) / 1000,
      y: 0,
      layer: "bottom",
    })),
  ]
  const original = structuredClone(points)
  const edges = buildMinimumSpanningTree(points, {
    getAdditionalEdgeCost: (from, to): number =>
      from.layer === to.layer ? 0 : 0.45,
  })
  expect(edges).toHaveLength(points.length - 1)
  expect(edges.filter(({ from, to }) => from.layer !== to.layer)).toHaveLength(
    1,
  )
  expect(
    edges.some(({ from, to }) => from.layer === "top" && to.layer === "top"),
  ).toBe(true)
  expect(points).toEqual(original)
})
