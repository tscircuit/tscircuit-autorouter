import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("complete MST candidates preserve existing equal-cost edge order", (): void => {
  const points = [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ]

  expect(buildMinimumSpanningTree(points)).toEqual([
    { from: points[0], to: points[2], weight: 1 },
    { from: points[0], to: points[1], weight: 1 },
    { from: points[1], to: points[3], weight: 1 },
  ])
})
