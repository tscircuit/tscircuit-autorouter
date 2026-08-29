import { expect, test } from "bun:test"
import {
  asNetworkedFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked accepts regional cleanup routes with shifted endpoints", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_regional_shifted_endpoints",
    connectionName: "A",
  })
  const shiftedRoute = createNetworkedRoute(node)
  shiftedRoute.route[0]!.x += 0.01
  shiftedRoute.route.at(-1)!.x -= 0.01
  const solver = createNetworkedHighDensitySolver({
    nodes: [node],
    fetchImpl: asNetworkedFetch(async () =>
      createNetworkedResponse({
        status: "solved",
        solutionStage: "regional-fallback",
        ordinaryFailure: "ordinary solver exhausted its candidates",
        routes: [shiftedRoute],
      }),
    ),
    enableRegionalFallback: true,
  })

  solver.step()
  await solver.pendingEffects![0]!.promise
  solver.step()

  expect(solver.routes).toHaveLength(1)
  expect(solver.routes[0]).toMatchObject(shiftedRoute)
  expect(solver.activeRegularSolver).toBeNull()
  expect(solver.activeFallbackSolver).toBeNull()
  expect(solver.stats.remoteRegionalFallbackResultsApplied).toBe(1)
  expect(solver.stats.remoteTransportFallbacks).toBe(0)
})
