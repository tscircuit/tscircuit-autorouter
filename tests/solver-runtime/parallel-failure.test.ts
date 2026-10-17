import { expect, test } from "bun:test"
import { ParallelSolver } from "../../lib/solvers/ParallelSolver/ParallelSolver"
import type { ParallelTaskBatch } from "../../lib/solver-runtime/ParallelTaskBatch"
import type { SolverRuntime } from "../../lib/solver-runtime/SolverRuntime"

class FailureSolver extends ParallelSolver<number, number> {
  committed = false
  protected getNextBatch(): ParallelTaskBatch<number, number> {
    return { inputs: [0, 1, 2], shared: undefined, runTask: (value) => value }
  }
  protected commitBatch(_outputs: readonly number[]): boolean {
    this.committed = true
    return true
  }
}

test("parallel batches choose the lowest indexed error and never partially commit", () => {
  const runtime: SolverRuntime = {
    runBatch: () => [
      { taskIndex: 2, ok: false, error: { name: "Error", message: "later" } },
      { taskIndex: 0, ok: true, output: 10 as any },
      { taskIndex: 1, ok: false, error: { name: "Error", message: "first" } },
    ],
    dispose: () => {},
  }
  const solver = new FailureSolver({ runtime })
  expect(() => solver.step()).toThrow("first")
  expect(solver.committed).toBe(false)
  expect(solver.failed).toBe(true)
})
