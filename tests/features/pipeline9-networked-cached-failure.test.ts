import { expect, test } from "bun:test"
import {
  asNetworkedFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked treats a cached solver failure like an ordinary local solver failure", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_cached_failure",
    connectionName: "A",
  })
  const solver = createNetworkedHighDensitySolver({
    nodes: [node],
    fetchImpl: asNetworkedFetch(async () =>
      createNetworkedResponse({
        status: "failed",
        error: "deterministically unsolved",
      }),
    ),
    enableRegionalFallback: false,
  })

  solver.step()
  await solver.pendingEffects![0]!.promise
  solver.step()

  expect(solver.failed).toBeTrue()
  expect(solver.activeRegularSolver).toBeNull()
  expect(solver.error).toContain(
    "regular high-density routing failed: deterministically unsolved",
  )
  expect(solver.stats.remoteFailedResults).toBe(1)
  expect(solver.stats.remoteTransportFallbacks).toBe(0)
})
