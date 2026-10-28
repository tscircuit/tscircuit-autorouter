import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("native world validation uses the original rotated pad while search keeps its approximation", (): void => {
  const route: HighDensityRoute = { connectionName: "wire", traceThickness: 0.02, viaDiameter: 0.3,
    route: [{ x: 0.2, y: -0.2, z: 0 }, { x: 0.35, y: -0.2, z: 0 }], vias: [] }
  const physicalPad: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 1, height: 0.1,
    ccwRotationDegrees: 45, layers: ["top"], connectedTo: ["foreign"] }
  const searchPad: Obstacle = { ...physicalPad, width: 0.8, height: 0.8, ccwRotationDegrees: 0 }
  const node: NodeWithPortPoints = { capacityMeshNodeId: "original-pad-shape", center: { x: 0, y: 0 },
    width: 2, height: 2, availableZ: [0, 1],
    portPoints: route.route.map((point) => ({ ...point, connectionName: route.connectionName })) }
  const connMap = new ConnectivityMap({ own: ["wire"], other: ["foreign"] })
  const solver = new Pipeline9HighDensitySolver({ nodePortPoints: [node], fixedHdRoutes: [], connMap,
    obstacles: [searchPad], ...createSyntheticOriginalPhysicalContext({ connectionNames: ["wire", "foreign"], connMap, layerCount: 2, obstacles: [physicalPad] }), layerCount: 2,
    viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.02, obstacleMargin: 0.15,
    effort: 0.1, cacheProvider: null })
  solver.step()
  expect(solver.activeRegularSolver!.obstacles[0]).toBe(searchPad)
  expect(solver.activeRegularSolver!.solutionValidator!([route])).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ routes: [route], connMap, layerCount: 2,
    traceClearance: 0.1, viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    boardObstacles: [searchPad], viaToPadClearance: 0.1 })).toBeFalse()
})
