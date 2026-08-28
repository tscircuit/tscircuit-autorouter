import { expect, test } from "bun:test"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib"
import {
  asNetworkedBatchFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 batch results fail open per node without discarding valid siblings", async () => {
  const nodes = [
    createNetworkedNode({
      nodeId: "cmn_batch_valid",
      connectionName: "valid",
      xOffset: -10,
    }),
    createNetworkedNode({
      nodeId: "cmn_batch_invalid",
      connectionName: "invalid",
    }),
    createNetworkedNode({
      nodeId: "cmn_batch_missing",
      connectionName: "missing",
      xOffset: 10,
    }),
  ]
  const solver = createNetworkedHighDensitySolver({
    nodes,
    fetchImpl: asNetworkedBatchFetch(async (_input, init) => {
      const request = JSON.parse(
        String(init?.body),
      ) as Pipeline9NetworkedSolveBatchRequest
      const validItem = request.items.find((item) =>
        item.input.nodeWithPortPoints.capacityMeshNodeId.endsWith("_valid"),
      )!
      const invalidItem = request.items.find((item) =>
        item.input.nodeWithPortPoints.capacityMeshNodeId.endsWith("_invalid"),
      )!
      return new Response(
        [
          JSON.stringify({
            requestId: validItem.requestId,
            ok: true,
            autorouterVersion: request.autorouterVersion,
            source: "cache",
            status: "solved",
            routes: [
              createNetworkedRoute(validItem.input.nodeWithPortPoints),
            ],
          }),
          JSON.stringify({
            requestId: invalidItem.requestId,
            ok: true,
            autorouterVersion: request.autorouterVersion,
            source: "cache",
            status: "solved",
            routes: [{}],
          }),
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        },
      )
    }),
  })

  solver.step()
  await solver.pendingEffects![0]!.promise
  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.solved).toBeTrue()
  expect(solver.stats.remoteRequestsCompleted).toBe(3)
  expect(solver.stats.remoteCacheHits).toBe(1)
  expect(solver.stats.remoteTransportFallbacks).toBe(2)
  expect(solver.stats.remoteBatchInvalidLines).toBe(1)
  expect(solver.stats.remoteFallbackReasonCounts).toEqual({
    invalid_response: 1,
    missing_response: 1,
  })
})
