import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 accepts direct solver results from the batch endpoint", async () => {
  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  try {
    const nodes = [
      createNetworkedNode({
        nodeId: "cmn_batch_solve_a",
        connectionName: "A",
        xOffset: -5,
      }),
      createNetworkedNode({
        nodeId: "cmn_batch_solve_b",
        connectionName: "B",
        xOffset: 5,
      }),
    ]
    const solver = createNetworkedHighDensitySolver({
      nodes,
      hdCache2ServerUrl: server.url,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBeTrue()
    expect(server.batchRequests).toHaveLength(1)
    expect(server.solveRequests).toHaveLength(0)
    expect(solver.routes.map(({ connectionName }) => connectionName)).toEqual([
      "B",
      "A",
    ])
    expect(solver.stats).toMatchObject({
      remoteRequestsStarted: 2,
      remoteRequestsCompleted: 2,
      remoteBatchRequestsStarted: 1,
      remoteBatchCacheMisses: 0,
      remoteSingleRequestsStarted: 0,
      remoteSolverResults: 2,
      remoteTransportFallbacks: 0,
    })
  } finally {
    await server.close()
  }
})
