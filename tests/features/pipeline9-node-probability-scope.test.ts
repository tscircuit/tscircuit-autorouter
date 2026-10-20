import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 keeps only the current node's probability without changing routes or metadata", () => {
  const node = createNetworkedNode({
    nodeId: "cmn_current",
    connectionName: "route_current",
  })
  const connMap = new ConnectivityMap({ root_current: ["route_current"] })
  let expectedRoutes: HighDensityIntraNodeRoute[] | undefined

  for (const probability of [0.25, 0, null, undefined]) {
    const probabilities: Record<CapacityMeshNodeId, number | null> = {}
    for (let index = 0; index < 1_000; index++) {
      probabilities[`unrelated_${index}`] = 0.99
    }
    if (probability !== undefined) {
      probabilities[node.capacityMeshNodeId] = probability
    }
    const probabilityMap = new Map<CapacityMeshNodeId, number | null>(
      Object.entries(probabilities),
    )

    for (const nodePfById of [probabilities, probabilityMap]) {
      const solver = createPipeline9RegularNodeSolver({
        nodeWithPortPoints: node,
        connMap,
        colorMap: {},
        viaDiameter: 0.3,
        traceWidth: 0.15,
        obstacleMargin: 0.15,
        effort: 1,
        nodePfById,
        obstacles: [],
        layerCount: 2,
      })

      expect([...solver.nodePfById]).toEqual([
        [node.capacityMeshNodeId, probability ?? null],
      ])
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(solver.routes).toHaveLength(1)
      expect(
        solver.nodeSolveMetadataById.get(node.capacityMeshNodeId)?.nodePf,
      ).toBe(probability ?? null)
      expect(Object.values(solver.stats.difficultNodePfs).flat()).toEqual(
        probability === 0.25 ? [0.25] : [],
      )
      expectedRoutes ??= solver.routes
      expect(solver.routes).toEqual(expectedRoutes)
    }
    expect(probabilityMap.size).toBe(Object.keys(probabilities).length)
  }
})
