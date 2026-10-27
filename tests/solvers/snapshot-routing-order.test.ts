import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { SnapshotBatchSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/snapshot/SnapshotBatchSolver"
import { SnapshotRouteBatchSolver, type SnapshotRouteBatchInput } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/snapshot/SnapshotRouteBatchSolver"
import { createSnapshotRoutingFixture } from "../fixtures/createSnapshotRoutingFixture"

test("snapshot waves commit in logical order even when tasks complete backwards and resume at a budget", async (): Promise<void> => {
  const input = createSnapshotRoutingFixture()
  const baseline = new SnapshotBatchSolver(input.topology, input.problem, input.options)
  baseline.solve()
  expect(baseline.solved).toBe(true)
  const pending: Array<() => void> = []
  const runtime = {
    executeAsync: (Solver: typeof SnapshotRouteBatchSolver, task: SnapshotRouteBatchInput) =>
      new Promise((resolve): void => {
        const isolated = structuredClone(task)
        pending.push((): void => {
          const solver = new Solver(isolated)
          solver.solve()
          resolve(solver.getOutput())
        })
      }),
  } as SolverRuntimeExecutor
  const parallel = new SnapshotBatchSolver(input.topology, input.problem, input.options)
  await parallel.solveAsync(runtime, 0)
  expect(pending).toHaveLength(0)
  const prefix = parallel.solveAsync(runtime, 1)
  expect(pending).toHaveLength(8)
  expect(parallel.batchStats.accepted).toBe(0)
  while (pending.length) pending.pop()!()
  await prefix
  expect(parallel.iterations).toBe(1)
  expect(parallel.batchStats.accepted).toBe(8)
  const rest = parallel.solveAsync(runtime)
  expect(pending).toHaveLength(2)
  while (pending.length) pending.pop()!()
  await rest
  expect(parallel.solved).toBe(true)
  expect(parallel.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(parallel.batchStats).toEqual(baseline.batchStats)
  expect(parallel.iterations).toBe(baseline.iterations)
})
