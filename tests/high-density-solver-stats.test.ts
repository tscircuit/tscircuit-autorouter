import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"

test("HighDensitySolver tracks solver counts and difficult node pfs", () => {
  const solver = new HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cn118",
        portPoints: [
          {
            x: -10.078125,
            y: 4.6875,
            z: 0,
            connectionName: "conn1",
          },
          {
            x: -9.84375,
            y: 3.75,
            z: 0,
            connectionName: "conn1",
          },
        ],
        center: {
          x: -9.84375,
          y: 4.21875,
        },
        width: 0.9375,
        height: 0.9375,
      },
    ],
    colorMap: {
      conn1: "hsl(0, 100%, 50%)",
    },
    nodePfById: {
      cn118: 0.07,
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)

  const solverNodeCount = solver.stats.solverNodeCount as Record<string, number>
  const difficultNodePfs = solver.stats.difficultNodePfs as Record<
    string,
    number[]
  >

  expect(solverNodeCount.CachedIntraNodeRouteSolver).toBeUndefined()
  expect(
    Object.values(solverNodeCount).reduce((sum, count) => sum + count, 0),
  ).toBe(1)
  expect(Object.values(difficultNodePfs).flat()).toEqual([0.07])
})
