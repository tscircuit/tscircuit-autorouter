import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked keeps a timed-out request warming", async () => {
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
      nodeId: "cmn_delayed_http",
      connectionName: "delayed_http",
    })
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      hdCache2ServerUrl: server.url,
      requestTimeoutMs: 30,
    })

    const solvePromise = solveNetworkedHighDensitySolver(solver)
    await requestStarted.promise
    await solvePromise

    expect(solver.solved).toBeTrue()
    expect(solver.stats.remoteLogicalTimeoutFallbacks).toBe(1)
    expect(server.solveRequests[0]?.finishedAt).toBeUndefined()

    releaseSolve.resolve()
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.solveRequests[0]?.finishedAt !== undefined) break
      await Bun.sleep(5)
    }
    expect(server.solveRequests[0]?.finishedAt).toBeNumber()
  } finally {
    releaseSolve.resolve()
    await server.close()
  }
})
