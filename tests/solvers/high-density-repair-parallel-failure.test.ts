import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { solveHighDensityRepairSample } from "lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"
import { createParallelRepairFixture } from "tests/fixtures/parallelRepairFixture"

test("parallel repair reports executor failures in node order and rejects invalid concurrency", async () => {
  const fixture = createParallelRepairFixture()
  for (const concurrency of [0, -1, 1.5, Infinity, NaN]) {
    expect(() => new Pipeline4HighDensityRepairSolver({
      ...fixture,
      parallelRepair: { concurrency, executor: async (input) => solveHighDensityRepairSample(input) },
    })).toThrow("positive integer")
  }
  for (const synchronousThrow of [false, true]) {
    const repair = new Pipeline4HighDensityRepairSolver({
      ...structuredClone(fixture),
      parallelRepair: {
        concurrency: 3,
        executor: (input) => {
          if (input.sample.nodeWithPortPoints!.capacityMeshNodeId === "node-1") {
            if (synchronousThrow) throw new Error("worker failed")
            return Promise.reject(new Error("worker failed"))
          }
          return Promise.resolve(solveHighDensityRepairSample(input))
        },
      },
    })
    await repair.solveAsync()
    expect(repair.failed).toBe(true)
    expect(repair.solved).toBe(false)
    expect(repair.error).toBe("High density repair failed for node node-1: worker failed")
    expect(repair.stats.repairedNodeCount).toBe(1)
    expect(repair.pendingEffects).toEqual([])
  }
  const empty = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [], hdRoutes: [], obstacles: [],
    parallelRepair: { executor: async () => { throw new Error("should not dispatch") } },
  })
  await empty.solveAsync()
  expect(empty.solved).toBe(true)
  expect(empty.getOutput()).toEqual([])
})
