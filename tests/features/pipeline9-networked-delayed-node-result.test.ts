import { expect, test } from "bun:test"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib"
import {
  asNetworkedBatchFetch,
  createNetworkedBatchStream,
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 uses a speculative result that finishes before its node is consumed", async () => {
  const delayedNode = createNetworkedNode({
    nodeId: "cmn_delayed_result",
    connectionName: "delayed",
    xOffset: -5,
  })
  const currentNode = createNetworkedNode({
    nodeId: "cmn_current_result",
    connectionName: "current",
    xOffset: 5,
  })
  const requestStarted = createDeferred<Pipeline9NetworkedSolveBatchRequest>()
  const batchStream = createNetworkedBatchStream()
  const solver = createNetworkedHighDensitySolver({
    nodes: [delayedNode, currentNode],
    requestTimeoutMs: 5,
    transportTimeoutMs: 1_000,
    fetchImpl: asNetworkedBatchFetch(async (_url, init) => {
      const request = JSON.parse(
        String(init?.body),
      ) as Pipeline9NetworkedSolveBatchRequest
      requestStarted.resolve(request)
      return batchStream.response
    }),
  })

  solver.step()
  const request = await requestStarted.promise
  const currentItem = request.items.find(
    (item) =>
      item.input.nodeWithPortPoints.capacityMeshNodeId ===
      currentNode.capacityMeshNodeId,
  )!
  const delayedItem = request.items.find(
    (item) =>
      item.input.nodeWithPortPoints.capacityMeshNodeId ===
      delayedNode.capacityMeshNodeId,
  )!
  batchStream.write({
    requestId: currentItem.requestId,
    ok: true,
    autorouterVersion: request.autorouterVersion,
    source: "cache",
    status: "solved",
    routes: [createNetworkedRoute(currentNode)],
  })
  await solver.pendingEffects![0]!.promise
  await new Promise((resolve) => setTimeout(resolve, 15))
  batchStream.write({
    requestId: delayedItem.requestId,
    ok: true,
    autorouterVersion: request.autorouterVersion,
    source: "cache",
    status: "solved",
    routes: [createNetworkedRoute(delayedNode)],
  })
  batchStream.close()
  while (solver.stats.remoteRequestsCompleted < 2) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  solver.step()
  solver.step()

  expect(solver.activeRegularSolver).toBeNull()
  expect(solver.routes.map((route) => route.connectionName)).toEqual([
    "current",
    "delayed",
  ])
  expect(solver.stats.remoteSolvedResults).toBe(2)
  expect(solver.stats.remoteLogicalTimeoutFallbacks).toBe(0)
})
