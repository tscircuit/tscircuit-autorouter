import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { SnapshotBatchSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/snapshot/SnapshotBatchSolver"
import { createSnapshotRoutingFixture } from "../fixtures/createSnapshotRoutingFixture"

test("registered snapshot jobs preserve serial output with one and four real workers and pool reuse", async (): Promise<void> => {
  const input = createSnapshotRoutingFixture()
  const baseline = new SnapshotBatchSolver(input.topology, input.problem, input.options)
  baseline.solve()
  expect(baseline.solved).toBe(true)
  for (const workerCount of [1, 4]) {
    const runtime = new SolverRuntime({workerCount, workerUrl: new URL("../../lib/runtime/node.worker.ts", import.meta.url), requireWorker: true})
    try {
      for (let repeat = 0; repeat < 2; repeat++) {
        const solver = new SnapshotBatchSolver(input.topology, input.problem, input.options)
        await solver.solveAsync(runtime)
        expect(solver.solved).toBe(true)
        expect(solver.state.regionSegments).toEqual(baseline.state.regionSegments)
        expect(solver.state.portAssignment).toEqual(baseline.state.portAssignment)
        expect(solver.batchStats).toEqual(baseline.batchStats)
        expect(solver.iterations).toBe(baseline.iterations)
      }
    } finally {
      await runtime.dispose()
    }
  }
})
