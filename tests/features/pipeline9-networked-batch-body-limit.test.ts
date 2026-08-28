import { expect, test } from "bun:test"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib"
import {
  asNetworkedBatchFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 greedily keeps every batch within its configured byte limit", async () => {
  const maxBatchBodyBytes = 50_000
  const requestBodies: string[] = []
  const solver = createNetworkedHighDensitySolver({
    nodes: Array.from({ length: 20 }, (_, index) =>
      createNetworkedNode({
        nodeId: `cmn_batch_bytes_${index}`,
        connectionName: `connection_${index}_${"x".repeat(500)}`,
        xOffset: index * 5,
      }),
    ),
    maxBatchBodyBytes,
    fetchImpl: asNetworkedBatchFetch(async (_input, init) => {
      const body = String(init?.body)
      requestBodies.push(body)
      const request = JSON.parse(body) as Pipeline9NetworkedSolveBatchRequest
      return new Response(
        `${request.items.map((item) => JSON.stringify({
          requestId: item.requestId,
          ok: false,
          message: "fixture miss",
        })).join("\n")}\n`,
        {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        },
      )
    }),
  })

  solver.step()
  await solver.pendingEffects![0]!.promise

  expect(requestBodies.length).toBeGreaterThan(1)
  expect(
    requestBodies.every(
      (body) => new TextEncoder().encode(body).byteLength <= maxBatchBodyBytes,
    ),
  ).toBeTrue()
  expect(
    requestBodies.flatMap(
      (body) =>
        (JSON.parse(body) as Pipeline9NetworkedSolveBatchRequest).items,
    ),
  ).toHaveLength(20)
  expect(solver.stats.remoteSingleRequestsStarted).toBe(0)
  expect(solver.stats.remoteBatchMaxBodyBytes).toBeLessThanOrEqual(
    maxBatchBodyBytes,
  )
  expect(solver.stats.remoteBatchBodyBytesStarted).toBe(
    requestBodies.reduce(
      (total, body) => total + new TextEncoder().encode(body).byteLength,
      0,
    ),
  )
})
