import { expect, test } from "bun:test"
import { ParallelHighDensitySolver } from "lib/solvers/HighDensitySolver/ParallelHighDensitySolver"
import type {
  HighDensitySolverExecutor,
  HighDensitySolverExecutorSession,
} from "lib/solvers/HighDensitySolver/high-density-parallel-types"

test("parallel high-density disposal closes a session during task startup", async () => {
  let markExecuteStarted!: () => void
  const executeStarted = new Promise<void>((resolve) => {
    markExecuteStarted = resolve
  })
  let rejectExecution!: (error: Error) => void
  let executeCount = 0
  let disposeCount = 0
  const session: HighDensitySolverExecutorSession = {
    async execute() {
      executeCount += 1
      markExecuteStarted()
      return await new Promise<never>((_, reject) => {
        rejectExecution = reject
      })
    },
    dispose() {
      disposeCount += 1
      rejectExecution(new Error("Executor session disposed during startup"))
    },
  }
  const executor: HighDensitySolverExecutor = {
    createSession() {
      return session
    },
  }
  const solver = new ParallelHighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cmn_dispose",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        portPoints: [],
      },
    ],
    parallelism: 2,
    executor,
  })

  solver.step()
  const pendingEffect = solver.pendingEffects![0]!
  await executeStarted
  await solver.dispose()
  await pendingEffect.promise

  expect(executeCount).toBe(1)
  expect(disposeCount).toBe(1)
  expect(solver.pendingEffects).toEqual([])
})
