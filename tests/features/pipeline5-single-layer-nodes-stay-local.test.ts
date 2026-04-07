import { expect, test } from "bun:test"
import { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test.skip("pipeline5 keeps single-layer high-density nodes local even when pair count is >= 3", () => {
  const singleLayerNode: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_single_layer",
    center: { x: 0, y: 0 },
    width: 4,
    height: 3,
    availableZ: [1],
    portPoints: [
      { x: -2, y: -1.5, z: 1, connectionName: "A" },
      { x: 2, y: -1.5, z: 1, connectionName: "A" },
      { x: -2, y: 0, z: 1, connectionName: "B" },
      { x: 2, y: 0, z: 1, connectionName: "B" },
      { x: -2, y: 1.5, z: 1, connectionName: "C" },
      { x: 2, y: 1.5, z: 1, connectionName: "C" },
    ],
  }

  let fetchCallCount = 0
  const fetchImpl = Object.assign(
    async () => {
      fetchCallCount += 1
      throw new Error("single-layer nodes should not reach hd-cache")
    },
    {
      preconnect: () => {},
    },
  ) as typeof fetch

  const solver = new Pipeline5HdCacheHighDensitySolver({
    nodePortPoints: [singleLayerNode],
    fetchImpl,
  })

  const localSolveCalls: Array<{
    node: NodeWithPortPoints
    nodeIndex: number
  }> = []
  ;(solver as any).solveNodeLocally = (
    node: NodeWithPortPoints,
    nodeIndex: number,
  ) => {
    localSolveCalls.push({ node, nodeIndex })
  }
  ;(solver as any).launchRemoteSolves()

  expect(fetchCallCount).toBe(0)
  expect(localSolveCalls).toEqual([
    {
      node: singleLayerNode,
      nodeIndex: 0,
    },
  ])
  expect(solver.stats.remoteRequestsStarted).toBe(0)
  expect(solver.pendingEffects).toEqual([])
})
