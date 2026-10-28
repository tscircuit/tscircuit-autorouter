import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolverFromCanonicalNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("native acceptance preserves declared copper clearance independently of the search margin", (): void => {
  const routes: HighDensityRoute[] = ["a", "b"].map((name, index) => ({
    connectionName: name, traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [{ x: -1, y: index * 0.25, z: 0 }, { x: 1, y: index * 0.25, z: 0 }],
  }))
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "declared-copper-gap", center: { x: 0, y: 0 }, width: 3, height: 3,
    availableZ: [0, 1], portPoints: routes.flatMap((route) => route.route.map((point) => ({ ...point, connectionName: route.connectionName }))),
  }
  const connMap = new ConnectivityMap({ netA: ["a"], netB: ["b"] })
  for (const physicalTraceClearance of [0.05, 0.1, 0.3]) {
    const solver = createPipeline9RegularNodeSolverFromCanonicalNode({
      nodeWithPortPoints: node, connMap, ...createSyntheticOriginalPhysicalContext({ connectionNames: ["a", "b"], connMap, layerCount: 2, obstacles: [] }),
      colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1,
      obstacleMargin: 0.2, physicalTraceClearance, effort: 1, nodePfById: {},
      obstacles: [], layerCount: 2, priorityDagSearch: true, cacheProvider: null,
    })
    expect(solver.obstacleMargin).toBe(0.2)
    expect(solver.solutionValidator!(routes)).toBe(physicalTraceClearance <= 0.15)
  }
})
