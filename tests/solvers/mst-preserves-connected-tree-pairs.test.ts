import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("preserve already connected local tree pairs", (): void => {
  const points = Array.from({ length: 4 }, (_, x) =>
    Array.from({ length: 7 }, (_, y) => ({ x, y, pointId: x * 7 + y })),
  ).flat()
  const edges = buildMinimumSpanningTree(points)

  expect(edges.map((edge) => [edge.from.pointId, edge.to.pointId])).toEqual([
    [0, 1],
    [0, 7],
    [1, 2],
    [1, 8],
    [2, 3],
    [2, 9],
    [3, 10],
    [3, 4],
    [7, 14],
    [8, 15],
    [9, 16],
    [10, 17],
    [10, 11],
    [11, 18],
    [12, 19],
    [13, 20],
    [14, 21],
    [15, 22],
    [16, 23],
    [17, 24],
    [18, 25],
    [18, 19],
    [19, 26],
    [19, 20],
    [20, 27],
    [3, 5],
    [6, 20],
  ])
})
