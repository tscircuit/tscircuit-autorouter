import { expect, test } from "bun:test"
import { ParallelHighDensitySolver } from "lib/solvers/HighDensitySolver/ParallelHighDensitySolver"

test("the Web Worker executor solves a structured-cloned high-density node", async () => {
  const solver = new ParallelHighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cmn_worker",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        portPoints: [
          { connectionName: "worker_net", x: -0.5, y: 0, z: 0 },
          { connectionName: "worker_net", x: 0.5, y: 0, z: 0 },
        ],
      },
    ],
    parallelism: 2,
    workerUrl: new URL("../lib/high-density-solver-worker.ts", import.meta.url)
      .href,
    useGrowShrinkHighDensityIntraNodeSolver: false,
    captureSearchDebug: false,
  })

  await solver.solveAsync()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(1)
  expect(solver.routes[0]?.connectionName).toBe("worker_net")
  expect(solver.pendingEffects).toEqual([])
})
