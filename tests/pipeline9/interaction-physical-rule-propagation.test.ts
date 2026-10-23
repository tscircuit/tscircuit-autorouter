import { test, expect } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"

test("the P9 phase passes physical hole dimensions and a large hole-gap rule into grouping", () => {
  const phase = new Pipeline9HighDensitySolver({ nodePortPoints: [{ capacityMeshNodeId: "rules", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [{ connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 0 }, { connectionName: "b", x: 0, y: -1, z: 0 }, { connectionName: "b", x: 0, y: 1, z: 0 }] }], fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: 0.3, viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.6, traceWidth: 0.1, obstacleMargin: 0.1, effort: 1 })
  phase.step()
  const native = phase.activeRegularSolver!
  expect(native.viaHoleDiameter).toBe(0.2)
  expect(native.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.6)
  native.step()
  const grow = native.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  grow.step()
  const portfolio = grow.activeSubSolver ?? grow.winningSolver!
  if (!portfolio.supervisedSolvers) portfolio.initializeSolvers()
  const group = portfolio.supervisedSolvers!.find(({ solver }) => solver instanceof Pipeline9InteractionGroupedHighDensitySolver)!.solver as Pipeline9InteractionGroupedHighDensitySolver
  expect(group.viaHoleDiameter).toBe(0.2)
  expect(group.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.6)
})
