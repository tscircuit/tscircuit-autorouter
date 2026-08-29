import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("concurrent remote solves share their request-launch logical deadline", async () => {
  const allRequestsStarted = createDeferred<void>()
  const releaseSolves = createDeferred<void>()
  let startedRequestCount = 0
  const server = new ExampleHdCache2Server({
    beforeSolve: async () => {
      startedRequestCount += 1
      if (startedRequestCount === 3) allRequestsStarted.resolve()
      await releaseSolves.promise
    },
  })
  try {
    const nodes = [
      createNetworkedNode({
        nodeId: "cmn_deadline_1",
        connectionName: "deadline_1",
        xOffset: -10,
      }),
      createNetworkedNode({
        nodeId: "cmn_deadline_2",
        connectionName: "deadline_2",
      }),
      createNetworkedNode({
        nodeId: "cmn_deadline_3",
        connectionName: "deadline_3",
        xOffset: 10,
      }),
    ]
    const solver = createNetworkedHighDensitySolver({
      nodes,
      hdCache2ServerUrl: server.url,
      requestTimeoutMs: 100,
    })

    const solvePromise = solveNetworkedHighDensitySolver(solver)
    await allRequestsStarted.promise
    await Bun.sleep(150)
    releaseSolves.resolve()
    await solvePromise

    expect(solver.solved).toBeTrue()
    expect(solver.routes).toHaveLength(3)
    expect(solver.stats.remoteLogicalTimeoutFallbacks).toBe(3)
    expect(solver.stats.remoteTransportFallbacks).toBe(3)
    expect(server.solveRequests).toHaveLength(3)
  } finally {
    releaseSolves.resolve()
    await server.close()
  }
})
