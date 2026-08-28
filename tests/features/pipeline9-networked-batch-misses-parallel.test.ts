import { expect, test } from "bun:test"
import type {
  Pipeline9NetworkedSolveBatchRequest,
  Pipeline9NetworkedSolveRequest,
} from "lib"
import {
  asNetworkedBatchFetch,
  createDeferred,
  createNetworkedBatchStream,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 streams multiple cache misses into concurrent out-of-order legacy solves", async () => {
  const nodes = [
    createNetworkedNode({
      nodeId: "cmn_miss_consumed_third",
      connectionName: "third",
      xOffset: -10,
    }),
    createNetworkedNode({
      nodeId: "cmn_miss_consumed_second",
      connectionName: "second",
    }),
    createNetworkedNode({
      nodeId: "cmn_miss_consumed_first",
      connectionName: "first",
      xOffset: 10,
    }),
  ]
  const batchStream = createNetworkedBatchStream()
  const batchStarted = createDeferred<Pipeline9NetworkedSolveBatchRequest>()
  const releasesByNodeId = new Map(
    nodes.map((node) => [node.capacityMeshNodeId, createDeferred<void>()]),
  )
  const singleStartOrder: string[] = []
  const singleCompletionOrder: string[] = []
  const solver = createNetworkedHighDensitySolver({
    nodes,
    requestTimeoutMs: 1_000,
    transportTimeoutMs: 5_000,
    fetchImpl: asNetworkedBatchFetch(async (input, init) => {
      if (String(input).endsWith("/solve-batch")) {
        batchStarted.resolve(
          JSON.parse(String(init?.body)) as Pipeline9NetworkedSolveBatchRequest,
        )
        return batchStream.response
      }

      const request = JSON.parse(
        String(init?.body),
      ) as Pipeline9NetworkedSolveRequest
      const nodeId = request.input.nodeWithPortPoints.capacityMeshNodeId
      singleStartOrder.push(nodeId)
      await releasesByNodeId.get(nodeId)!.promise
      singleCompletionOrder.push(nodeId)
      return createNetworkedResponse({
        source: "solver",
        status: "solved",
        routes: [createNetworkedRoute(request.input.nodeWithPortPoints)],
      })
    }),
  })

  solver.step()
  const batchRequest = await batchStarted.promise
  for (const [itemIndex, item] of batchRequest.items.entries()) {
    batchStream.write({
      requestId: item.requestId,
      ok: false,
      autorouterVersion: batchRequest.autorouterVersion,
      code: "CACHE_MISS",
      message: "exact key not found",
    })
    while (singleStartOrder.length < itemIndex + 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  expect(singleStartOrder).toEqual([
    "cmn_miss_consumed_first",
    "cmn_miss_consumed_second",
    "cmn_miss_consumed_third",
  ])
  expect(singleCompletionOrder).toEqual([])

  releasesByNodeId.get("cmn_miss_consumed_third")!.resolve()
  while (singleCompletionOrder.length < 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  releasesByNodeId.get("cmn_miss_consumed_first")!.resolve()
  while (singleCompletionOrder.length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  releasesByNodeId.get("cmn_miss_consumed_second")!.resolve()
  while (solver.stats.remoteRequestsCompleted < nodes.length) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  while (!solver.solved && !solver.failed) solver.step()

  expect(singleCompletionOrder).toEqual([
    "cmn_miss_consumed_third",
    "cmn_miss_consumed_first",
    "cmn_miss_consumed_second",
  ])
  expect(solver.solved).toBeTrue()
  expect(solver.routes.map((route) => route.connectionName)).toEqual([
    "first",
    "second",
    "third",
  ])
  expect(solver.stats.remoteBatchCacheMisses).toBe(3)
  expect(solver.stats.remoteSingleRequestsStarted).toBe(3)
  expect(solver.stats.remoteRequestsStarted).toBe(3)
  expect(solver.stats.remoteRequestsCompleted).toBe(3)
  expect(solver.stats.remoteSolverResults).toBe(3)
  expect(solver.stats.remoteBatchInvalidLines).toBe(0)
  expect(solver.stats.remoteTransportFallbacks).toBe(0)
})
