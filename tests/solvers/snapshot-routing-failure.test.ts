import { expect, test } from "bun:test"
import { SnapshotBatchSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/snapshot/SnapshotBatchSolver"
import { createSnapshotRoutingFixture } from "../fixtures/createSnapshotRoutingFixture"

test("snapshot worker rejection fails without partial commits and rejects concurrent solves", async (): Promise<void> => {
  const input = createSnapshotRoutingFixture()
  const solver = new SnapshotBatchSolver(input.topology, input.problem, input.options)
  const rejections: Array<(error: Error) => void> = []
  const pending = solver.solveAsync({
    executeAsync: () => new Promise((_resolve, reject): void => { rejections.push(reject) }),
  }).catch((error: unknown): unknown => error)
  await expect(solver.solveAsync()).rejects.toThrow("already running")
  for (const reject of rejections) reject(new Error("worker unavailable"))
  expect(String(await pending)).toContain("worker unavailable")
  expect(solver.failed).toBe(true)
  expect(solver.batchStats.accepted).toBe(0)
  expect(solver.state.regionSegments.every(segments => segments.length === 0)).toBe(true)
})
