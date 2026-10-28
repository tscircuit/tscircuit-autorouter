import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import originalContext from "../fixtures/pipeline9-native-world-guards/cmn42-strict-context-known-search-limitation.json"

test("owned single-task cmn87 searches a legal bend when the empty-route shortcut hits an original foreign pad", (): void => {
  // Keep the original global plan so this regression exercises the unsafe
  // detailed-routing shortcut even when interior costs can avoid the region.
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(originalContext.originalSrj) as SimpleRouteJson,
    { effort: 1, cacheProvider: null, usePhysicalNetForest: true, usePhysicalNetForestInteriorCosts: false })
  pipeline.solveUntilPhase("highDensityRouteSolver")
  if (!pipeline.highDensityRouteSolver) pipeline.step()
  const allNodes = pipeline.highDensityRouteSolver!
  expect(allNodes.iterations).toBe(0)
  const node = allNodes.unsolvedNodePortPoints.find((candidate) => candidate.capacityMeshNodeId === "cmn_87")!
  expect(node.portPoints).toHaveLength(2)
  const params = Reflect.get(allNodes, "params") as ConstructorParameters<typeof Pipeline9HighDensitySolver>[0]
  const physical = {
    connMap: params.connMap, physicalOwnership: params.physicalOwnership,
    layerCount: params.layerCount, allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
    traceClearance: params.physicalTraceClearance ?? 0.1,
    traceToPadClearance: params.traceToPadClearance, traceToHoleClearance: params.traceToHoleClearance,
    viaHoleDiameter: params.viaHoleDiameter ?? params.viaDiameter,
    minViaHoleEdgeToViaHoleEdgeClearance: params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
    boardObstacles: params.physicalBoardObstacles!, viaToPadClearance: params.viaToPadClearance ?? 0.1,
    immutableRoutes: params.fixedHdRoutes,
  }
  const raw = new Native({ connectionName: node.portPoints[0]!.connectionName,
    rootConnectionName: node.portPoints[0]!.rootConnectionName, regionId: node.capacityMeshNodeId,
    A: node.portPoints[0]!, B: node.portPoints[1]!, obstacleRoutes: [], futureConnections: [],
    bounds: getBoundsFromNodeWithPortPoints(node), minDistBetweenEnteringPoints: 0.1,
    layerCount: params.layerCount, availableZ: node.availableZ, viaDiameter: params.viaDiameter,
    traceThickness: params.traceWidth, obstacleMargin: params.obstacleMargin })
  expect(raw.solved).toBeTrue()
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...physical, routes: [raw.solvedPath!] })).toBeFalse()
  const fixedBefore = JSON.stringify(params.fixedHdRoutes)
  const solver = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [node], cacheProvider: null })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.routes).toHaveLength(1)
  expect(solver.routes[0]!.vias).toEqual([])
  expect(solver.routes[0]!.route.length).toBeGreaterThan(2)
  expect(solver.stats.promotedFallbackAttemptCount).toBe(0)
  expect(solver.fixedRouteReplacements.size).toBe(0)
  expect(solver.MAX_ITERATIONS).toBe(100e6 * params.effort)
  expect(arePipeline9NativeRoutesPhysicallyValid({ ...physical, routes: solver.routes })).toBeTrue()
  expect(JSON.stringify(solver.getUpdatedFixedHdRoutes())).toBe(fixedBefore)
})
