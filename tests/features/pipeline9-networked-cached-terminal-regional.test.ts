import { expect, test } from "bun:test"
import {
  asNetworkedFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked applies a cached terminal regional result without local fallback work", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_cached_terminal_regional",
    connectionName: "A",
  })
  const route = createNetworkedRoute(node)
  const solver = createNetworkedHighDensitySolver({
    nodes: [node],
    fetchImpl: asNetworkedFetch(async () =>
      createNetworkedResponse({
        status: "solved",
        solutionStage: "regional-fallback",
        ordinaryFailure: "ordinary solver exhausted its candidates",
        routes: [route],
      }),
    ),
    enableRegionalFallback: true,
  })

  solver.step()
  await solver.pendingEffects![0]!.promise
  solver.step()
  solver.step()

  expect(solver.solved).toBeTrue()
  expect(solver.activeRegularSolver).toBeNull()
  expect(solver.activeFallbackSolver).toBeNull()
  expect(solver.routes).toHaveLength(1)
  expect(solver.routes[0]).toMatchObject(route)
  expect(solver.stats.fallbackNodeCount).toBe(1)
  expect(solver.stats.remoteRegionalFallbackResults).toBe(1)
  expect(solver.stats.remoteRegionalFallbackResultsApplied).toBe(1)
  expect(solver.stats.remoteRegionalFallbackResultsDeferredToLocal).toBe(0)
})
