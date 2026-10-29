import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createDeferred,
  createNetworkedFixedRoute,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("a speculative HTTP request never blocks a fixed-copper B01 node", async () => {
  const requestStarted = createDeferred<void>()
  const releaseSolve = createDeferred<void>()
  const server = new ExampleHdCache2Server({
    beforeSolve: async () => {
      requestStarted.resolve()
      await releaseSolve.promise
    },
  })
  try {
    const node = createNetworkedNode({
      nodeId: "cmn_fixed_overlap_http",
      connectionName: "fixed_overlap_http",
    })
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      fixedHdRoutes: [createNetworkedFixedRoute()],
      hdCache2ServerUrl: server.url,
    })

    solver.step()
    expect(solver.pendingEffects).toEqual([])
    expect(solver.activeB01Solver).not.toBeNull()
    const iterationsBefore = solver.activeB01Solver!.iterations
    solver.step()
    expect(solver.activeB01Solver!.iterations).toBeGreaterThan(iterationsBefore)

    await requestStarted.promise
    releaseSolve.resolve()
  } finally {
    releaseSolve.resolve()
    await server.close()
  }
})
