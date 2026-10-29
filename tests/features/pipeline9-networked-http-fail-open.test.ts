import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked fails open when the cache server is unavailable", async () => {
  const server = new ExampleHdCache2Server()
  const serverUrl = server.url
  await server.close()
  const node = createNetworkedNode({
    nodeId: "cmn_unavailable",
    connectionName: "unavailable",
  })
  const solver = createNetworkedHighDensitySolver({
    nodes: [node],
    hdCache2ServerUrl: serverUrl,
  })

  await solveNetworkedHighDensitySolver(solver)

  expect(solver.solved).toBeTrue()
  expect(solver.routes).toHaveLength(1)
  expect(solver.stats.remoteTransportFallbacks).toBe(1)
})
