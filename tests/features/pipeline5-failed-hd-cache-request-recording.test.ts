import { expect, test } from "bun:test"
import { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const remoteEligibleNode: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_remote_fail",
  center: { x: 0, y: 0 },
  width: 4,
  height: 3,
  availableZ: [0, 1],
  portPoints: [
    { x: -2, y: -1.5, z: 0, connectionName: "A" },
    { x: 2, y: -1.5, z: 0, connectionName: "A" },
    { x: -2, y: 0, z: 1, connectionName: "B" },
    { x: 2, y: 0, z: 1, connectionName: "B" },
    { x: -2, y: 1.5, z: 0, connectionName: "C" },
    { x: 2, y: 1.5, z: 0, connectionName: "C" },
  ],
}

test.skip("pipeline5 records failed hd-cache requests on window for replay", async () => {
  const fetchImpl = Object.assign(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          source: "none",
          pairCount: 3,
          bucketKey: "vectorize:3",
          bucketSize: 0,
          routes: null,
          drc: null,
          message: "Solver did not find a solution.",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    {
      preconnect: () => {},
    },
  ) as typeof fetch

  const solver = new Pipeline5HdCacheHighDensitySolver({
    nodePortPoints: [remoteEligibleNode],
    fetchImpl,
  })

  const localFallbackCalls: Array<{
    node: NodeWithPortPoints
    nodeIndex: number
    opts: Record<string, unknown>
  }> = []
  ;(solver as any).solveNodeLocally = (
    node: NodeWithPortPoints,
    nodeIndex: number,
    opts: Record<string, unknown>,
  ) => {
    localFallbackCalls.push({ node, nodeIndex, opts })
  }

  const originalWindow = (globalThis as { window?: unknown }).window
  const failedRequestWindow: {
    __FAILED_HD_CACHE_REQUESTS?: unknown[]
  } = {}
  ;(globalThis as { window?: unknown }).window = failedRequestWindow

  try {
    await (solver as any).solveNodeViaHdCache(remoteEligibleNode, 0)
  } finally {
    ;(globalThis as { window?: unknown }).window = originalWindow
  }

  expect(localFallbackCalls).toHaveLength(1)
  expect(localFallbackCalls[0]?.node.capacityMeshNodeId).toBe("cmn_remote_fail")
  expect(localFallbackCalls[0]?.opts.remoteFailure).toBe(
    "Solver did not find a solution.",
  )

  const failedRequests =
    failedRequestWindow.__FAILED_HD_CACHE_REQUESTS as Array<Record<string, any>>
  expect(Array.isArray(failedRequests)).toBe(true)
  expect(failedRequests).toHaveLength(1)

  const failedRequest = failedRequests[0]
  expect(failedRequest.nodeId).toBe("cmn_remote_fail")
  expect(failedRequest.pairCount).toBe(3)
  expect(failedRequest.url).toBe("https://hd-cache.tscircuit.com/solve")
  expect(failedRequest.durationMs).toBeGreaterThanOrEqual(0)
  expect(failedRequest.error).toBe("Solver did not find a solution.")
  expect(failedRequest.request).toEqual({
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      nodeWithPortPoints: remoteEligibleNode,
    }),
    bodyJson: {
      nodeWithPortPoints: remoteEligibleNode,
    },
  })
  expect(failedRequest.response).toEqual({
    status: 200,
    ok: true,
    text: JSON.stringify({
      ok: false,
      source: "none",
      pairCount: 3,
      bucketKey: "vectorize:3",
      bucketSize: 0,
      routes: null,
      drc: null,
      message: "Solver did not find a solution.",
    }),
    body: {
      ok: false,
      source: "none",
      pairCount: 3,
      bucketKey: "vectorize:3",
      bucketSize: 0,
      routes: null,
      drc: null,
      message: "Solver did not find a solution.",
    },
  })
  expect(new Date(failedRequest.failedAt).toString()).not.toBe("Invalid Date")
})
