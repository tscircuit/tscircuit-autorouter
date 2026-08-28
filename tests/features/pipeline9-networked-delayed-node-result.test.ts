import { expect, test } from "bun:test"
import type { Pipeline9NetworkedSolveRequest } from "lib"
import {
  asNetworkedFetch,
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
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
  const releaseDelayedResponse = createDeferred<void>()
  const delayedResponseFinished = createDeferred<void>()
  const solver = createNetworkedHighDensitySolver({
    nodes: [delayedNode, currentNode],
    requestTimeoutMs: 5,
    transportTimeoutMs: 1_000,
    fetchImpl: asNetworkedFetch(async (_url, init) => {
      const request = JSON.parse(
        String(init?.body),
      ) as Pipeline9NetworkedSolveRequest
      if (
        request.input.nodeWithPortPoints.capacityMeshNodeId ===
        delayedNode.capacityMeshNodeId
      ) {
        await releaseDelayedResponse.promise
        delayedResponseFinished.resolve()
      }
      return createNetworkedResponse({
        status: "solved",
        routes: [createNetworkedRoute(request.input.nodeWithPortPoints)],
      })
    }),
  })

  solver.step()
  await solver.pendingEffects![0]!.promise
  await new Promise((resolve) => setTimeout(resolve, 15))
  releaseDelayedResponse.resolve()
  await delayedResponseFinished.promise
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
