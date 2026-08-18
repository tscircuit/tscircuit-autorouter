import { expect, test } from "bun:test"
import { ParallelHighDensitySolver } from "lib/solvers/HighDensitySolver/ParallelHighDensitySolver"
import type { HighDensitySolverExecutor } from "lib/solvers/HighDensitySolver/high-density-parallel-types"

test("parallel high-density failures preserve failed-solver metadata", async () => {
  const executor: HighDensitySolverExecutor = {
    createSession() {
      return {
        async execute(task) {
          return {
            nodeIndex: task.nodeIndex,
            status: "failed",
            routes: [
              {
                connectionName: "partial_connection",
                traceThickness: 0.15,
                viaDiameter: 0.3,
                route: [],
                vias: [],
              },
            ],
            solverType: "failed-worker-solver",
            iterations: 42,
            routeCount: 1,
            growthAttempts: 3,
            cacheHits: 0,
            cacheMisses: 1,
            error: "worker could not route the node",
          }
        },
        dispose() {},
      }
    },
  }
  const solver = new ParallelHighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cmn_failed",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        portPoints: [],
      },
    ],
    parallelism: 2,
    executor,
  })

  await solver.solveAsync()

  expect(solver.failed).toBe(true)
  expect(solver.routes).toEqual([])
  expect(solver.failedSolvers).toHaveLength(1)
  expect(solver.failedSolvers[0]?.iterations).toBe(42)
  expect(solver.failedSolvers[0]?.solvedRoutes).toHaveLength(1)
  expect(solver.nodeSolveMetadataById.get("cmn_failed")?.routeCount).toBe(1)
  expect(solver.error).toContain("worker could not route the node")
})
