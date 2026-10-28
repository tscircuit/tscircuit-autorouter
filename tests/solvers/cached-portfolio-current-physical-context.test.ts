import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("cached portfolios validate successes in the current physical context and re-search unverifiable cached failures", (): void => {
  const cacheProvider = new InMemoryCache()
  const connMap = new ConnectivityMap({ signalNet: ["a", "b"], otherSignalNet: ["c", "d"], foreign: ["foreign"] })
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "physical-cache-context", center: { x: 0, y: 0 }, width: 3, height: 3,
    availableZ: [0, 1], portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "section", rootConnectionName: "signalNet" },
      { x: 1, y: 0, z: 0, connectionName: "section", rootConnectionName: "signalNet" },
    ],
  }
  const cachedRoute: HighDensityIntraNodeRoute = {
    connectionName: "section", rootConnectionName: "signalNet", traceThickness: 0.1, viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 }, { x: -0.3, y: 0.5, z: 0 },
      { x: -0.3, y: 0.5, z: 1 }, { x: 0.3, y: 0.5, z: 1 },
      { x: 0.3, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 },
    ],
    vias: [{ x: -0.3, y: 0.5 }, { x: 0.3, y: 0.5 }],
  }
  const foreignPad: Obstacle = { type: "rect", center: { x: -0.3, y: 0.5 },
    width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign"] }
  const base = { nodeWithPortPoints, connMap, cacheProvider, traceWidth: 0.1,
    viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2, effort: 0.1 }
  let validationCalls = 0
  const validator = (boardObstacles: Obstacle[]) => (routes: HighDensityIntraNodeRoute[]): boolean => {
    validationCalls++
    return arePipeline9NativeRoutesPhysicallyValid({ routes, boardObstacles, connMap,
      layerCount: 2, traceClearance: 0.1, viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1, viaToPadClearance: 0.1 })
  }
  const validHit = new CachedPortfolioSingleIntraNodeSolver({ ...base, solutionValidator: validator([]) })
  const { cacheKey } = validHit.computeCacheKeyAndTransform()
  cacheProvider.setCachedSolutionSync(cacheKey, { success: true, solvedRoutes: [cachedRoute] })
  validHit.step()
  expect(validHit.solved).toBeTrue()
  expect(validHit.cacheHit).toBeTrue()
  expect(validHit.supervisedSolvers).toBeUndefined()
  expect(validationCalls).toBe(1)
  expect(validHit.solvedRoutes).toEqual([cachedRoute])

  const changedContext = new CachedPortfolioSingleIntraNodeSolver({ ...base,
    obstacles: [foreignPad], solutionValidator: validator([foreignPad]) })
  expect(changedContext.computeCacheKeyAndTransform().cacheKey).toBe(cacheKey)
  changedContext.solve()
  expect(changedContext.cacheHit).toBeFalse()
  expect(changedContext.stats.physicalCacheCandidateRejectionCount).toBe(1)
  expect(changedContext.supervisedSolvers!.length).toBeGreaterThan(0)
  expect(changedContext.solved).toBeTrue()
  expect(changedContext.failed).toBeFalse()
  expect(changedContext.solvedRoutes.every((route) => route.vias.length === 0)).toBeTrue()

  expect(connMap.getNetConnectedToId("section")).toBeUndefined()
  for (const currentRoot of ["otherSignalNet", undefined]) {
    const currentHit = new CachedPortfolioSingleIntraNodeSolver({ ...base,
      nodeWithPortPoints: { ...nodeWithPortPoints, portPoints: nodeWithPortPoints.portPoints.map(
        (point) => ({ ...point, rootConnectionName: currentRoot }),
      ) },
      obstacles: [foreignPad], solutionValidator: (routes): boolean =>
        routes.every((route) => route.rootConnectionName === currentRoot) && validator([foreignPad])(routes) })
    const callsBeforeHit = validationCalls
    expect(currentHit.computeCacheKeyAndTransform().cacheKey).toBe(cacheKey)
    currentHit.step()
    expect(currentHit.cacheHit).toBeTrue()
    expect(currentHit.solved).toBeTrue()
    expect(validationCalls).toBe(callsBeforeHit + 1)
    expect(currentHit.solvedRoutes.every((route) => route.rootConnectionName === currentRoot)).toBeTrue()
  }
  cacheProvider.setCachedSolutionSync(cacheKey, { success: false })
  const staleFailure = new CachedPortfolioSingleIntraNodeSolver({ ...base, solutionValidator: validator([]) })
  staleFailure.solve()
  expect(staleFailure.cacheHit).toBeFalse()
  expect(staleFailure.stats.physicalCacheFailureRejectionCount).toBe(1)
  expect(staleFailure.solved).toBeTrue()
  expect(staleFailure.failed).toBeFalse()

  cacheProvider.setCachedSolutionSync(cacheKey, { success: true,
    solvedRoutes: [{ ...cachedRoute, connectionName: "retired-section" }] })
  const staleIdentity = new CachedPortfolioSingleIntraNodeSolver({ ...base, solutionValidator: validator([]) })
  staleIdentity.solve()
  expect(staleIdentity.cacheHit).toBeFalse()
  expect(staleIdentity.stats.physicalCacheIdentityRejectionCount).toBe(1)
  expect(staleIdentity.solved).toBeTrue()
  expect(staleIdentity.solvedRoutes.every((route) => route.connectionName === "section")).toBeTrue()

  const goodCacheEntry = cacheProvider.getCachedSolutionSync(cacheKey)
  const contextFailure = new CachedPortfolioSingleIntraNodeSolver({ ...base, solutionValidator: validator([foreignPad]) })
  contextFailure.failed = true
  contextFailure.saveToCacheSync()
  expect(contextFailure.stats.physicalCacheFailureSaveSkippedCount).toBe(1)
  expect(cacheProvider.getCachedSolutionSync(cacheKey)).toEqual(goodCacheEntry)
  const validatorError = new CachedPortfolioSingleIntraNodeSolver({ ...base,
    solutionValidator: (): boolean => { throw new Error("physical invariant failed") } })
  expect(() => validatorError.step()).toThrow("physical invariant failed")
  expect(validatorError.cacheHit).toBeFalse()
  expect(validatorError.failed).toBeTrue()
})
