import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked rejects an empty solved route set", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_empty_routes_http",
    connectionName: "empty_routes_http",
  })
  const server = new ExampleHdCache2Server({
    batchItemMode: "solve",
    mapBatchLine: (line) => {
      expect(line.status).toBe("solved")
      expect(line.routes).toHaveLength(1)
      return { ...line, status: "solved", routes: [] }
    },
  })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      hdCache2ServerUrl: server.url,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBeTrue()
    expect(solver.routes).toHaveLength(1)
    expect(solver.stats.remoteTransportFallbacks).toBe(1)
    expect(solver.stats.remoteFallbackReasonCounts).toEqual({
      invalid_response: 1,
    })
  } finally {
    await server.close()
  }
})
