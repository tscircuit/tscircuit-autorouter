import { expect, test } from "bun:test"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib"
import {
  asNetworkedBatchFetch,
  createDeferred,
  createNetworkedBatchStream,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 logical timeout leaves the shared batch alive for sibling results", async () => {
  const batchStream = createNetworkedBatchStream()
  const requestStarted = createDeferred<{
    request: Pipeline9NetworkedSolveBatchRequest
    signal: AbortSignal
  }>()
  const solver = createNetworkedHighDensitySolver({
    nodes: [
      createNetworkedNode({
        nodeId: "cmn_batch_timeout_first",
        connectionName: "first",
        xOffset: -5,
      }),
      createNetworkedNode({
        nodeId: "cmn_batch_timeout_second",
        connectionName: "second",
        xOffset: 5,
      }),
    ],
    requestTimeoutMs: 5,
    transportTimeoutMs: 1_000,
    fetchImpl: asNetworkedBatchFetch(async (_input, init) => {
      requestStarted.resolve({
        request: JSON.parse(
          String(init?.body),
        ) as Pipeline9NetworkedSolveBatchRequest,
        signal: init?.signal as AbortSignal,
      })
      return batchStream.response
    }),
  })

  solver.step()
  const { request, signal } = await requestStarted.promise
  await solver.pendingEffects![0]!.promise
  expect(signal.aborted).toBeFalse()

  for (const item of request.items) {
    batchStream.write({
      requestId: item.requestId,
      ok: true,
      autorouterVersion: request.autorouterVersion,
      source: "cache",
      status: "solved",
      routes: [createNetworkedRoute(item.input.nodeWithPortPoints)],
    })
  }
  batchStream.close()
  while (solver.stats.remoteRequestsCompleted < 2) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.solved).toBeTrue()
  expect(signal.aborted).toBeFalse()
  expect(solver.stats.remoteCacheHits).toBe(2)
  expect(solver.stats.remoteLogicalTimeoutFallbacks).toBe(1)
  expect(solver.stats.remoteTransportFallbacks).toBe(1)
  expect(solver.stats.remoteFallbackReasonCounts).toEqual({
    logical_timeout: 1,
  })
})
