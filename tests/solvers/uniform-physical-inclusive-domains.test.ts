import { expect, test } from "bun:test"
import { subtractEdgeIntervals } from "lib/solvers/UniformPortDistributionSolver/getSharedEdgePhysicalIntervals"

test("open blocked intervals preserve exact tangent singletons and nanometre legal gaps", (): void => {
  expect(
    subtractEdgeIntervals(
      [[0, 1]],
      [
        [-1, 0.5],
        [0.5, 2],
      ],
    ),
  ).toEqual([[0.5, 0.5]])
  const gap = subtractEdgeIntervals(
    [[0, 1]],
    [
      [-1, 0.5],
      [0.5 + 1e-10, 2],
    ],
  )
  expect(gap).toEqual([[0.5, 0.5 + 1e-10]])
  expect(subtractEdgeIntervals([[0, 1]], [[-1, 2]])).toEqual([])
  expect(subtractEdgeIntervals([[0, 1]], [[0, 1]])).toEqual([
    [0, 0],
    [1, 1],
  ])
})
