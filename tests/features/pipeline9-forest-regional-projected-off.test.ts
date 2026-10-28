import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import { PIPELINE9_NETWORKED_SOLVE_POLICY } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { createNetworkedCrossingNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("default and projected regional callers preserve the legacy policy while explicit null cache still propagates", (): void => {
  const node = createNetworkedCrossingNode({ nodeId: "projected-legacy-region" })
  const params: ConstructorParameters<typeof Pipeline9RegionalFallbackSolver>[0] = {
    nodeWithPortPoints: node, connMap: new ConnectivityMap({ horizontal: ["horizontal"], vertical: ["vertical"] }),
    colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    obstacles: [], layerCount: 2, cacheProvider: null,
    // Supplying optional geometry cannot opt a shared caller into a new policy.
    boardGeometry: { bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, minBoardEdgeClearance: 0.2 },
    viaHoleDiameter: 0.16, minViaHoleEdgeToViaHoleEdgeClearance: 0.21, allowBlindAndBuriedVias: true,
    priorityDiagnostics: { untouched: 1 },
  }
  const legacy = new HighDensitySolver({
    cacheProvider: null, nodePortPoints: [node], colorMap: params.colorMap, connMap: params.connMap,
    viaDiameter: params.viaDiameter, traceWidth: params.traceWidth, obstacleMargin: params.obstacleMargin,
    effort: params.effort, nodePfById: params.nodePfById, obstacles: params.obstacles, layerCount: params.layerCount,
    useGrowShrinkHighDensityIntraNodeSolver: true, preserveTerminalPcbPortIds: false,
    growShrinkFallbackToInvalidGeometryOnFailure: false,
  })
  for (const useNativeRouting of [undefined, false]) {
    const regional = new Pipeline9RegionalFallbackSolver({ ...params, useNativeRouting })
    const solver = regional.highDensitySolver
    for (const key of ["viaDiameter", "traceWidth", "obstacleMargin", "effort", "layerCount",
      "enableNegotiatedSearch", "gridSearchSegmentWork", "gridSearchWorkScale", "rejectOverlappingTerminals",
      "boardGeometry", "useGrowShrinkHighDensityIntraNodeSolver", "preserveTerminalPcbPortIds",
      "growShrinkFallbackToInvalidGeometryOnFailure", "captureSearchDebug", "MAX_ITERATIONS"] as const) {
      expect(solver[key]).toEqual(legacy[key])
    }
    expect(solver.unsolvedNodePortPoints).toEqual(legacy.unsolvedNodePortPoints)
    expect(solver.obstacles).toBe(params.obstacles)
    expect(solver.cacheProvider).toBeNull()
    expect(solver.priorityDagOptions).toEqual(legacy.priorityDagOptions)
    expect(solver.priorityDagOptions.priorityDagSearch).toBe(false)
    expect(solver.enableNegotiatedSearch).toBe(false)
    expect(solver.gridSearchSegmentWork).toBe(10_000)
    expect(solver.gridSearchWorkScale).toBe(1)
    expect(solver.benchmarkDiagnosticCounters).toEqual({})
    expect(params.priorityDiagnostics).toEqual({ untouched: 1 })
  }

  const previousCache = globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE
  const processCache = new InMemoryCache()
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = processCache
  const captured: Pipeline9RegionalFallbackSolver[] = []
  const solve = Pipeline9RegionalFallbackSolver.prototype.solve
  const observe = spyOn(Pipeline9RegionalFallbackSolver.prototype, "solve").mockImplementation(function (this: Pipeline9RegionalFallbackSolver): void {
    captured.push(this)
    solve.call(this)
  })
  try {
    const result = solvePipeline9NetworkedHighDensityNode({
      solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY, enableRegionalFallback: true,
      nodeWithPortPoints: node, connectivityNetMap: params.connMap.netMap, colorMap: {},
      viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
      obstacles: [], regionalObstacles: [], layerCount: 2, nodePf: null, boardGeometry: params.boardGeometry,
    })
    expect(result.status).toBe("solved")
    expect(result.solutionStage).toBe("regional-fallback")
    expect(captured).toHaveLength(1)
    const projected = captured[0]!
    expect(projected.params.useNativeRouting).toBeUndefined()
    expect(projected.highDensitySolver.priorityDagOptions).toEqual(legacy.priorityDagOptions)
    expect(projected.highDensitySolver.enableNegotiatedSearch).toBe(false)
    expect(projected.highDensitySolver.gridSearchSegmentWork).toBe(10_000)
    expect(projected.highDensitySolver.gridSearchWorkScale).toBe(1)
    expect(projected.highDensitySolver.boardGeometry).toBeUndefined()
    // The projected request has no cache-provider field; its existing global
    // default remains separate from explicit null in the local controls above.
    expect(projected.highDensitySolver.cacheProvider).toBe(processCache)
  } finally {
    observe.mockRestore()
    globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = previousCache
  }
})
