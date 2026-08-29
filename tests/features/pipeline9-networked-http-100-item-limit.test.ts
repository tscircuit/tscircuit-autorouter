import { expect, test } from "bun:test"
import { HD_CACHE2_MAX_BATCH_BODY_BYTES } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/hd-cache2-client"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 keeps real HTTP batches within the protocol limits", async () => {
  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  try {
    const nodeCount = 101
    const solver = createNetworkedHighDensitySolver({
      nodes: Array.from({ length: nodeCount }, (_, index) =>
        createNetworkedNode({
          nodeId: `cmn_http_batch_limit_${index}`,
          connectionName: `connection_${index}`,
          xOffset: index * 5,
        }),
      ),
      hdCache2ServerUrl: server.url,
    })

    await solveNetworkedHighDensitySolver(solver)

    const batchItemCounts = server.batchRequests
      .map(
        ({ body }) =>
          (body as Pipeline9NetworkedSolveBatchRequest).items.length,
      )
      .sort((left, right) => right - left)
    expect(batchItemCounts).toEqual([100, 1])
    expect(
      server.batchRequests.every(
        ({ bodyBytes }) => bodyBytes <= HD_CACHE2_MAX_BATCH_BODY_BYTES,
      ),
    ).toBeTrue()
    expect(
      server.batchRequests.reduce(
        (itemCount, { body }) =>
          itemCount +
          (body as Pipeline9NetworkedSolveBatchRequest).items.length,
        0,
      ),
    ).toBe(nodeCount)
    expect(solver.stats.remoteBatchItemsStarted).toBe(nodeCount)
    expect(solver.stats.remoteBatchMaxBodyBytes).toBe(
      Math.max(...server.batchRequests.map(({ bodyBytes }) => bodyBytes)),
    )
    expect(solver.stats.remoteBatchBodyBytesStarted).toBe(
      server.batchRequests.reduce(
        (total, { bodyBytes }) => total + bodyBytes,
        0,
      ),
    )
    expect(server.solveRequests).toHaveLength(0)
    expect(solver.solved).toBeTrue()
  } finally {
    await server.close()
  }
})
