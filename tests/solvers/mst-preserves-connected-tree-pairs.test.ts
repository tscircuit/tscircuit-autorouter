import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Terminal = { x: number; y: number; pointId: number }

test("build a local tree without skipping neighboring terminals", (): void => {
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

  expect(
    edges.map((edge): [number, number] => [edge.from.pointId, edge.to.pointId]),
  ).toEqual([
    [0, 1],
    [0, 7],
    [1, 2],
    [1, 8],
    [2, 3],
    [2, 9],
    [3, 10],
    [3, 4],
    [4, 11],
    [4, 5],
    [5, 6],
    [5, 12],
    [6, 13],
    [7, 14],
    [8, 15],
    [9, 16],
    [10, 17],
    [11, 18],
    [12, 19],
    [13, 20],
    [14, 21],
    [15, 22],
    [16, 23],
    [17, 24],
    [18, 25],
    [19, 26],
    [20, 27],
  ])
})
