import { test, expect } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("a single proposed route cannot hide a close drill pair under a large hole-gap rule", () => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "own-drills", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [{ connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 0 }] }
  const solver = new Pipeline9InteractionGroupedHighDensitySolver({ nodePortPoints: [node], connMap: new ConnectivityMap({}), viaDiameter: 0.3, viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.6, traceWidth: 0.1, obstacleMargin: 0.1, layerCount: 2 })
  const route: HighDensityRoute = { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0 }, { x: -0.25, y: 0, z: 0 }, { x: -0.25, y: 0, z: 1 }, { x: 0.25, y: 0, z: 1 }, { x: 0.25, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [{ x: -0.25, y: 0 }, { x: 0.25, y: 0 }] }
  const valid = (solver as unknown as { validateGroup: (routes: HighDensityRoute[], node: NodeWithPortPoints) => boolean }).validateGroup([route], node)
  expect(valid).toBe(false)
  expect(solver.stats.experimentalInteractionDrillConflicts).toBe(1)
  expect(solver.stats.experimentalInteractionCandidateRejections).toBe(1)
  expect(solver.routes).toHaveLength(0)
})
