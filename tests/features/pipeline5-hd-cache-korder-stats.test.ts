import { expect, test } from "bun:test"
import { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const createRemoteEligibleNode = (nodeId: string, xOffset: number) =>
  ({
    capacityMeshNodeId: nodeId,
    center: { x: xOffset, y: 0 },
    width: 4,
    height: 3,
    availableZ: [0, 1],
    portPoints: [
      { x: xOffset - 2, y: -1.5, z: 0, connectionName: "A" },
      { x: xOffset + 2, y: -1.5, z: 0, connectionName: "A" },
      { x: xOffset - 2, y: 0, z: 1, connectionName: "B" },
      { x: xOffset + 2, y: 0, z: 1, connectionName: "B" },
      { x: xOffset - 2, y: 1.5, z: 0, connectionName: "C" },
      { x: xOffset + 2, y: 1.5, z: 0, connectionName: "C" },
    ],
  }) satisfies NodeWithPortPoints

test.skip("pipeline5 records p50 and p95 remote kOrder stats from hd-cache responses", async () => {
  const kOrders = Array.from({ length: 21 }, (_, index) => index + 1)
  const nodes = kOrders.map((kOrder) =>
    createRemoteEligibleNode(`cmn_korder_${kOrder}`, kOrder * 10),
  )

  let fetchCallCount = 0
  const fetchImpl = Object.assign(
    async () => {
      const kOrder = kOrders[fetchCallCount]
      fetchCallCount += 1

      return new Response(
        JSON.stringify({
          ok: true,
          source: "solver",
          pairCount: 3,
          bucketKey: "vectorize:3",
          bucketSize: 1,
          kOrder,
          routes: [
            {
              connectionName: "A",
              route: [
                { x: -2, y: -1.5, z: 0 },
                { x: 2, y: -1.5, z: 0 },
              ],
              vias: [],
            },
          ],
          drc: {
            ok: true,
            issues: [],
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      )
    },
    {
      preconnect: () => {},
    },
  ) as typeof fetch

  const solver = new Pipeline5HdCacheHighDensitySolver({
    nodePortPoints: nodes,
    fetchImpl,
  })

  solver.step()
  await Promise.all(
    solver.pendingEffects?.map((effect) => effect.promise) ?? [],
  )
  solver.step()

  expect(fetchCallCount).toBe(kOrders.length)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.remoteRequestsStarted).toBe(kOrders.length)
  expect(solver.stats.remoteRequestsCompleted).toBe(kOrders.length)
  expect(solver.stats.remoteResponseSampleCount).toBe(kOrders.length)
  expect(solver.stats.remoteKOrderSampleCount).toBe(kOrders.length)
  expect(solver.stats.p50RemoteKOrder).toBe(11)
  expect(solver.stats.p95RemoteKOrder).toBe(20)
})
