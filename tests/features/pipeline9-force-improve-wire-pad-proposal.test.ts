import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("force improvement rejects a wire-only numerical proposal that moves valid copper into a foreign pad", (): void => {
  const route: HighDensityRoute = { connectionName: "wire", rootConnectionName: "wire", regionId: "node",
    traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [[-4, 0], [-3, 0], [-1, 2], [1, 2], [3, 0], [4, 0]].map(([x, y]) => ({ x: x!, y: y!, z: 0 })) }
  const node: NodeWithPortPoints = { capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 10, height: 10,
    availableZ: [0, 1], portPoints: [{ x: -4, y: 0, z: 0, connectionName: "wire" }, { x: 4, y: 0, z: 0, connectionName: "wire" }] }
  const pad: Obstacle = { type: "rect", center: { x: 0, y: 1.65 }, width: 0.1, height: 0.1,
    layers: ["top"], connectedTo: ["foreign"] }
  const connectivityNetMap = { own: ["wire"], other: ["foreign"] }
  const physical = { layerCount: 2, traceClearance: 0.1, traceToPadClearance: 0.1,
    viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    boardObstacles: [pad], viaToPadClearance: 0.1 }
  const connMap = new ConnectivityMap(connectivityNetMap)
  const params = { hdRoutes: [route], nodeWithPortPoints: [node], colorMap: {}, totalStepsPerNode: 20, nodeAssignmentMargin: 0.15 }
  const before = structuredClone(route)
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...physical, connMap, routes: [route] })).toBeTrue()
  const numerical = new HighDensityForceImproveSolver(params)
  numerical.solve()
  expect(numerical.getOutput()[0]!.vias).toEqual([])
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...physical, connMap, routes: numerical.getOutput() })).toBeFalse()
  const guarded = new Pipeline9HighDensityForceImproveSolver({ ...params,
    physicalValidation: { ...physical, connectivityNetMap } })
  guarded.solve()
  expect(guarded.solved).toBeTrue()
  expect(guarded.stats.physicalCandidateRejectionCount).toBe(1)
  expect(guarded.getOutput()).toEqual([before])
  expect(route).toEqual(before)
})
