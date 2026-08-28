import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
import {
  asNetworkedBatchFetch,
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked launches every node request in parallel and preserves sequential output metadata", async () => {
  const firstNode = createNetworkedNode({
    nodeId: "cmn_first",
    connectionName: "A",
    xOffset: -5,
  })
  const secondNode = createNetworkedNode({
    nodeId: "cmn_second",
    connectionName: "B",
    xOffset: 5,
  })
  const releaseRequests = createDeferred<void>()
  const requestBodies: Pipeline9NetworkedSolveBatchRequest[] = []
  const requestUrls: string[] = []
  const fetchImpl = asNetworkedBatchFetch(async (input, init) => {
    requestUrls.push(String(input))
    const request = JSON.parse(
      String(init?.body),
    ) as Pipeline9NetworkedSolveBatchRequest
    requestBodies.push(request)
    await releaseRequests.promise
    return new Response(
      `${request.items
        .map((item) =>
          JSON.stringify({
            requestId: item.requestId,
            ok: true,
            autorouterVersion: request.autorouterVersion,
            source: "cache",
            status: "solved",
            routes: [createNetworkedRoute(item.input.nodeWithPortPoints)],
          }),
        )
        .join("\n")}\n`,
      {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      },
    )
  })
  const solver = createNetworkedHighDensitySolver({
    nodes: [firstNode, secondNode],
    fetchImpl,
  })

  solver.step()

  expect(requestBodies).toHaveLength(1)
  expect(requestUrls[0]).toEndWith("/solve-batch")
  expect(requestBodies[0]!.autorouterVersion).toBe(AUTOROUTER_VERSION)
  expect(requestBodies[0]!.items).toHaveLength(2)
  expect(requestBodies[0]!.items.map((item) => item.input.effort)).toEqual([
    1, 1,
  ])
  expect(solver.pendingEffects).toHaveLength(1)

  releaseRequests.resolve()
  await solver.pendingEffects![0]!.promise
  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.routes.map((route) => route.connectionName)).toEqual(["B", "A"])
  expect(solver.routes.map((route) => route.rootConnectionName)).toEqual([
    "root_B",
    "root_A",
  ])
  expect(solver.routes.map((route) => route.startPcbPortId)).toEqual([
    "cmn_second_start",
    "cmn_first_start",
  ])
  expect(solver.routes.map((route) => route.endPcbPortId)).toEqual([
    "cmn_second_end",
    "cmn_first_end",
  ])
  expect(solver.stats.remoteRequestsStarted).toBe(2)
  expect(solver.stats.remoteCacheHits).toBe(2)
  expect(solver.stats.remoteBatchRequestsStarted).toBe(1)
  expect(solver.stats.remoteBatchItemsStarted).toBe(2)
  expect(solver.stats.remoteSingleRequestsStarted).toBe(0)
})
