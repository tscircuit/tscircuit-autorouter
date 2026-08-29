import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked propagates and validates a benchmark cache version", async () => {
  const cacheVersion = "benchmark-123-456-1"
  const server = new ExampleHdCache2Server()

  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: [
        createNetworkedNode({
          nodeId: "cache_version_node",
          connectionName: "cache_version_connection",
        }),
      ],
      hdCache2ServerUrl: server.url,
      hdCache2CacheVersion: cacheVersion,
    })
    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBe(true)
    expect(server.batchRequests).toHaveLength(1)
    expect(server.solveRequests).toHaveLength(1)
    for (const request of server.requests) {
      expect(request.body).toMatchObject({ cacheVersion })
    }
  } finally {
    await server.close()
  }

  const mismatchedServer = new ExampleHdCache2Server({
    batchItemMode: "solve",
    mapBatchLine: (line) => ({ ...line, cacheVersion: "wrong-version" }),
  })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: [
        createNetworkedNode({
          nodeId: "mismatched_cache_version_node",
          connectionName: "mismatched_cache_version_connection",
        }),
      ],
      hdCache2ServerUrl: mismatchedServer.url,
      hdCache2CacheVersion: cacheVersion,
    })
    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBe(true)
    expect(solver.stats.remoteTransportFallbacks).toBe(1)
    expect(solver.stats.remoteFallbackReasonCounts).toEqual({
      cache_version_mismatch: 1,
    })
  } finally {
    await mismatchedServer.close()
  }
})
