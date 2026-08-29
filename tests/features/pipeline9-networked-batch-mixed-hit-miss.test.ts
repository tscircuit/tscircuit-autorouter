import { expect, test } from "bun:test"
import type {
  Pipeline9NetworkedSolveBatchRequest,
  Pipeline9NetworkedSolveRequest,
} from "lib"
import {
  asNetworkedBatchFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 fans a batch cache miss out to legacy solve without losing hit correlation", async () => {
  const hitNode = createNetworkedNode({
    nodeId: "cmn_batch_hit",
    connectionName: "hit",
    xOffset: -5,
  })
  const missNode = createNetworkedNode({
    nodeId: "cmn_batch_miss",
    connectionName: "miss",
    xOffset: 5,
  })
  const requestUrls: string[] = []
  const singleRequests: Pipeline9NetworkedSolveRequest[] = []
  const solver = createNetworkedHighDensitySolver({
    nodes: [hitNode, missNode],
    fetchImpl: asNetworkedBatchFetch(async (input, init) => {
      const requestUrl = String(input)
      requestUrls.push(requestUrl)
      if (requestUrl.endsWith("/solve-batch")) {
        const request = JSON.parse(
          String(init?.body),
        ) as Pipeline9NetworkedSolveBatchRequest
        const hitItem = request.items.find(
          (item) =>
            item.input.nodeWithPortPoints.capacityMeshNodeId ===
            hitNode.capacityMeshNodeId,
        )!
        const missItem = request.items.find(
          (item) =>
            item.input.nodeWithPortPoints.capacityMeshNodeId ===
            missNode.capacityMeshNodeId,
        )!
        return new Response(
          `${[
            {
              requestId: hitItem.requestId,
              ok: true,
              autorouterVersion: request.autorouterVersion,
              source: "cache",
              status: "solved",
              solutionStage: "ordinary",
              routes: [createNetworkedRoute(hitItem.input.nodeWithPortPoints)],
            },
            {
              requestId: missItem.requestId,
              ok: false,
              autorouterVersion: request.autorouterVersion,
              code: "CACHE_MISS",
              message: "exact key not found",
            },
          ]
            .map((line) => JSON.stringify(line))
            .join("\n")}\n`,
          {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          },
        )
      }

      const request = JSON.parse(
        String(init?.body),
      ) as Pipeline9NetworkedSolveRequest
      singleRequests.push(request)
      return createNetworkedResponse({
        source: "solver",
        status: "solved",
        routes: [createNetworkedRoute(request.input.nodeWithPortPoints)],
      })
    }),
  })

  solver.step()
  await solver.pendingEffects![0]!.promise
  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.solved).toBeTrue()
  expect(
    requestUrls.filter((url) => url.endsWith("/solve-batch")),
  ).toHaveLength(1)
  expect(requestUrls.filter((url) => url.endsWith("/solve"))).toHaveLength(1)
  expect(singleRequests).toHaveLength(1)
  expect(singleRequests[0]!.input.nodeWithPortPoints.capacityMeshNodeId).toBe(
    missNode.capacityMeshNodeId,
  )
  expect(solver.routes.map((route) => route.connectionName)).toEqual([
    "miss",
    "hit",
  ])
  expect(solver.stats.remoteBatchCacheMisses).toBe(1)
  expect(solver.stats.remoteSingleRequestsStarted).toBe(1)
  expect(solver.stats.remoteRequestsStarted).toBe(2)
  expect(solver.stats.remoteRequestsCompleted).toBe(2)
  expect(solver.stats.remoteCacheHits).toBe(1)
  expect(solver.stats.remoteSolverResults).toBe(1)
  expect(solver.stats.remoteBatchInvalidLines).toBe(0)
  expect(solver.stats.remoteTransportFallbacks).toBe(0)
})
