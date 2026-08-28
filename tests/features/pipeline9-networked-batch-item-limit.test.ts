import { expect, test } from "bun:test"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib"
import {
  asNetworkedBatchFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 launches no more than 100 items in each batch", async () => {
  const requests: Pipeline9NetworkedSolveBatchRequest[] = []
  const solver = createNetworkedHighDensitySolver({
    nodes: Array.from({ length: 101 }, (_, index) =>
      createNetworkedNode({
        nodeId: `cmn_batch_limit_${index}`,
        connectionName: `connection_${index}`,
        xOffset: index * 5,
      }),
    ),
    fetchImpl: asNetworkedBatchFetch(async (_input, init) => {
      const request = JSON.parse(
        String(init?.body),
      ) as Pipeline9NetworkedSolveBatchRequest
      requests.push(request)
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

  expect(requests.map((request) => request.items.length)).toEqual([100, 1])
  expect(requests.flatMap((request) => request.items)).toHaveLength(101)
  expect(solver.stats.remoteBatchRequestsStarted).toBe(2)
  expect(solver.stats.remoteBatchItemsStarted).toBe(101)
  expect(solver.stats.remoteSingleRequestsStarted).toBe(0)
})
