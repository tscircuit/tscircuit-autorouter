import { expect, test } from "bun:test"
import {
  asNetworkedFetch,
  createDeferred,
  createNetworkedFixedRoute,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked does not await a speculative fixed-copper node request", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_fixed_overlap",
    connectionName: "A",
  })
  const deferredResponse = createDeferred<Response>()
  let fetchCallCount = 0
  const solver = createNetworkedHighDensitySolver({
    nodes: [node],
    fixedHdRoutes: [createNetworkedFixedRoute()],
    fetchImpl: asNetworkedFetch(async () => {
      fetchCallCount += 1
      return deferredResponse.promise
    }),
  })

  solver.step()

  expect(fetchCallCount).toBe(1)
  expect(solver.pendingEffects).toEqual([])
  expect(solver.activeB01Solver).not.toBeNull()
  const b01Solver = solver.activeB01Solver!
  const b01IterationsBefore = b01Solver.iterations
  solver.step()
  expect(b01Solver.iterations).toBeGreaterThan(b01IterationsBefore)

  deferredResponse.resolve(
    createNetworkedResponse({
      status: "solved",
      routes: [createNetworkedRoute(node)],
    }),
  )
  await Promise.resolve()
  expect(solver.routes).toEqual([])
})
