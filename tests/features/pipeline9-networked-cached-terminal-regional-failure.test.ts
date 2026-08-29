import { expect, test } from "bun:test"
import {
  asNetworkedFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked consumes a cached terminal regional failure without repeating local work", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_cached_terminal_regional_failure",
    connectionName: "A",
  })
  const terminalError =
    "Pipeline9 primary high-density routing failed: regular high-density routing failed: ordinary exhausted; regional fallback failed: regional exhausted"
  const solver = createNetworkedHighDensitySolver({
    nodes: [node],
    fetchImpl: asNetworkedFetch(async () =>
      createNetworkedResponse({
        status: "failed",
        solutionStage: "regional-fallback",
        ordinaryFailure: "ordinary exhausted",
        error: terminalError,
      }),
    ),
    enableRegionalFallback: true,
  })

  solver.step()
  await solver.pendingEffects![0]!.promise
  solver.step()

  expect(solver.failed).toBeTrue()
  expect(solver.error).toBe(terminalError)
  expect(solver.activeRegularSolver).toBeNull()
  expect(solver.activeFallbackSolver).toBeNull()
  expect(solver.stats.remoteRegionalFallbackResults).toBe(1)
  expect(solver.stats.remoteRegionalFallbackResultsApplied).toBe(1)
  expect(solver.stats.remoteRegionalFallbackResultsDeferredToLocal).toBe(0)
})
