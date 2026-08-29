import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked rejects a corrupted real server result per node", async () => {
  const nodes = [
    createNetworkedNode({
      nodeId: "cmn_valid_http",
      connectionName: "valid_http",
      xOffset: -5,
    }),
    createNetworkedNode({
      nodeId: "cmn_corrupt_http",
      connectionName: "corrupt_http",
      xOffset: 5,
    }),
  ]
  const server = new ExampleHdCache2Server({
    batchItemMode: "solve",
    mapBatchLine: (line, item) =>
      item.input.nodeWithPortPoints.capacityMeshNodeId === "cmn_corrupt_http"
        ? { ...line, autorouterVersion: "corrupted-version" }
        : line,
  })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes,
      hdCache2ServerUrl: server.url,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBeTrue()
    expect(solver.routes).toHaveLength(2)
    expect(solver.stats.remoteTransportFallbacks).toBe(1)
    expect(server.batchRequests).toHaveLength(1)
  } finally {
    await server.close()
  }
})
