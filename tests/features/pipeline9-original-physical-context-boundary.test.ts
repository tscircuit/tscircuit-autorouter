import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, createPipeline9RegularNodeSolverFromCanonicalNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"

test("original-world guards require complete original context while legacy native policy and explicit via-pad validation remain active", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "context-boundary", center: { x: 0, y: 0 },
    width: 3, height: 3, availableZ: [1, 3], portPoints: [
      { x: -1, y: 0, z: 1, connectionName: "new" }, { x: 1, y: 0, z: 3, connectionName: "new" },
    ] }
  const connMap = new ConnectivityMap({})
  const pad: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2,
    layers: ["top"], connectedTo: ["foreign"] }
  const original = createSyntheticOriginalPhysicalContext({ connectionNames: ["new", "foreign"],
    connMap, layerCount: 4, obstacles: [pad] })
  const common = { nodeWithPortPoints: node, connMap, colorMap: {}, viaDiameter: 0.3, viaHoleDiameter: 0.15,
    traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.1, nodePfById: {}, obstacles: [pad], layerCount: 4,
    priorityDagSearch: true, cacheProvider: null } as const
  const legacy = createPipeline9RegularNodeSolverFromCanonicalNode({ ...common, obstacles: [pad] })
  const owned = createPipeline9RegularNodeSolverFromCanonicalNode({ ...common, obstacles: [pad], ...original })
  expect(legacy.solutionValidator).toBeUndefined()
  expect(legacy.routeFragmentValidator).toBeUndefined()
  expect(owned.solutionValidator).toBeFunction()
  expect(owned.routeFragmentValidator).toBeFunction()
  expect(legacy.priorityDagOptions).toEqual(owned.priorityDagOptions)
  const directParams = { ...common, obstacles: [pad], nodePortPoints: [node], fixedHdRoutes: [] }
  expect(new Pipeline9HighDensitySolver({ ...directParams, ...original }).physicalTraceClearance).toBeUndefined()
  expect(new Pipeline9HighDensitySolver({ ...directParams, ...original, useNativeRegionalRouting: true }).physicalTraceClearance).toBe(0.1)
  expect(new Pipeline9HighDensitySolver({ ...directParams, useNativeRegionalRouting: true }).physicalTraceClearance).toBeUndefined()
  const message = "requires both physicalOwnership and physicalBoardObstacles"
  for (const partial of [{ physicalOwnership: original.physicalOwnership }, { physicalBoardObstacles: [pad] }]) {
    expect(() => createPipeline9RegularNodeSolverFromCanonicalNode({ ...common, obstacles: [pad], ...partial })).toThrow(message)
    expect(() => new Pipeline9HighDensitySolver({ ...common, obstacles: [pad], nodePortPoints: [node], fixedHdRoutes: [], ...partial })).toThrow(message)
    expect(() => new Pipeline9RegionalFallbackSolver({ ...common, obstacles: [pad], ...partial })).toThrow(message)
  }
  const route: HighDensityRoute = { connectionName: "new", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 3 }], vias: [{ x: 0, y: 0 }] }
  const priorExplicitRule = new Pipeline9RegionalFallbackSolver({ ...common, obstacles: [pad], useNativeRouting: true,
    boardObstacles: [pad], movablePreloadedConnectionNames: new Set(["new"]), viaToPadClearance: 0.1 })
  expect(priorExplicitRule.hasOriginalPhysicalContext).toBeFalse()
  expect(Reflect.get(priorExplicitRule, "validateCandidateRoutes").call(priorExplicitRule, [route])).toBeFalse()
  expect(priorExplicitRule.stats.preloadedViaCandidateRejectionCount).toBe(1)
  const strict = new Pipeline9RegionalFallbackSolver({ ...common, obstacles: [pad], useNativeRouting: true,
    boardObstacles: [pad], ...original })
  expect(strict.hasOriginalPhysicalContext).toBeTrue()
  expect(strict.highDensitySolver.routeFragmentValidator!(route)).toBeFalse()
  expect(Reflect.get(strict, "validateCandidateRoutes").call(strict, [route])).toBeFalse()
})
