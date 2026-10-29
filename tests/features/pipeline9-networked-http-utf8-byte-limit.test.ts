import { expect, test } from "bun:test"
import { HD_CACHE2_MAX_BATCH_BODY_BYTES } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/HdCache2Client"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 splits real HTTP batches by exact UTF-8 body bytes", async () => {
  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: Array.from({ length: 20 }, (_, index) =>
        createNetworkedNode({
          nodeId: `cmn_http_batch_bytes_${index}`,
          connectionName: `connection_${index}_${"é".repeat(10_000)}`,
          xOffset: index * 5,
        }),
      ),
      hdCache2ServerUrl: server.url,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(server.batchRequests.length).toBeGreaterThan(1)
    expect(
      server.batchRequests.every(
        ({ bodyBytes }) => bodyBytes <= HD_CACHE2_MAX_BATCH_BODY_BYTES,
      ),
    ).toBeTrue()
    expect(
      server.batchRequests.reduce(
        (count, { body }) =>
          count + (body as Pipeline9NetworkedSolveBatchRequest).items.length,
        0,
      ),
    ).toBe(20)
    expect(server.solveRequests).toHaveLength(0)
    expect(solver.solved).toBeTrue()
  } finally {
    await server.close()
  }
})
