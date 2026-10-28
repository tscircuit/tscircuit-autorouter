import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolverFromCanonicalNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("native physical proposals query actual restored copper envelopes against the cached original board", (): void => {
  let distantReads = 0
  const board: Obstacle[] = [
    { type: "rect", shape: "circle", center: { x: 10, y: 0 }, width: 0.2, height: 0.2,
      isNonPlatedHole: true, layers: ["top"], connectedTo: [] },
    { type: "rect", center: { get x() { distantReads++; return 100 }, y: 100 }, width: 1, height: 1,
      layers: ["top"], connectedTo: [] },
  ]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "query-node", center: { x: 0, y: 0 },
    width: 2, height: 2, availableZ: [1, 3], portPoints: [
      { x: -1, y: 0, z: 1, connectionName: "new" }, { x: 1, y: 0, z: 3, connectionName: "new" },
    ] }
  const connMap = new ConnectivityMap({})
  const solver = createPipeline9RegularNodeSolverFromCanonicalNode({ nodeWithPortPoints: node,
    connMap, colorMap: {}, viaDiameter: 0.3, traceWidth: 0.02, obstacleMargin: 0.15,
    layerCount: 4, effort: 0.1, nodePfById: {}, obstacles: [], ...createSyntheticOriginalPhysicalContext({ connectionNames: ["new"], connMap, layerCount: 4, obstacles: board }),
    physicalRouteDimensionsByConnectionName: { new: { traceThickness: 0.8, viaDiameter: 0.3 } },
    priorityDagSearch: true, cacheProvider: null })
  const fragment: HighDensityIntraNodeRoute = { connectionName: "new", traceThickness: 0.02, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 1 }, { x: 0.1, y: 0, z: 1 }], vias: [] }
  expect(solver.routeFragmentValidator!(fragment)).toBeTrue()
  const readsAfterIndexing = distantReads
  expect(readsAfterIndexing).toBeGreaterThan(0)
  expect(solver.routeFragmentValidator!({ ...fragment,
    route: [{ x: 10.5, y: -0.1, z: 1 }, { x: 10.5, y: 0.1, z: 1 }] })).toBeFalse()
  expect(solver.routeFragmentValidator!({ ...fragment,
    route: [{ x: 10, y: 0, z: 1 }, { x: 10, y: 0, z: 3 }], vias: [{ x: 10, y: 0 }] })).toBeFalse()
  expect(distantReads).toBe(readsAfterIndexing)
})
