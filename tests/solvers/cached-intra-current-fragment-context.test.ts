import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("cached ordinary native routes validate current physical fragments before a hit and re-search a changed pad context", (): void => {
  const cacheProvider = new InMemoryCache()
  const connMap = new ConnectivityMap({ signal: ["section"], other: ["foreign"] })
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "ordinary-physical-cache", center: { x: 0, y: 0 }, width: 3, height: 3,
    availableZ: [0], portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "section", rootConnectionName: "signal" },
      { x: 1, y: 0, z: 0, connectionName: "section", rootConnectionName: "signal" },
    ],
  }
  const straight: HighDensityIntraNodeRoute = {
    connectionName: "section", rootConnectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [],
  }
  const pad: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2,
    layers: ["top"], connectedTo: ["foreign"] }
  const base = { nodeWithPortPoints, connMap, cacheProvider, traceWidth: 0.1,
    viaDiameter: 0.3, obstacleMargin: 0.15, captureSearchDebug: false }
  let validationCalls = 0
  const validator = (boardObstacles: Obstacle[]) => (route: HighDensityIntraNodeRoute): boolean => {
    validationCalls++
    return arePipeline9NativeRoutesPhysicallyValid({ routes: [route], boardObstacles, connMap,
      layerCount: 2, traceClearance: 0.1, viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1, viaToPadClearance: 0.1 })
  }
  const validHit = new CachedIntraNodeRouteSolver({ ...base, routeFragmentValidator: validator([]) })
  const { cacheKey } = validHit.computeCacheKeyAndTransform()
  cacheProvider.setCachedSolutionSync(cacheKey, { success: true, solvedRoutes: [straight] })
  validHit.step()
  expect(validHit.cacheHit).toBeTrue()
  expect(validHit.solved).toBeTrue()
  expect(validationCalls).toBe(1)
  expect(validHit.solvedRoutes).toEqual([straight])
  expect(validHit.solvedRoutes[0]).not.toBe(straight)

  const changedContext = new CachedIntraNodeRouteSolver({ ...base,
    obstacles: [pad], routeFragmentValidator: validator([pad]) })
  expect(changedContext.computeCacheKeyAndTransform().cacheKey).toBe(cacheKey)
  changedContext.solve()
  expect(changedContext.cacheHit).toBeFalse()
  expect(changedContext.stats.physicalCacheCandidateRejectionCount).toBe(1)
  expect(changedContext.solved).toBeTrue()
  expect(changedContext.failed).toBeFalse()
  expect(changedContext.solvedRoutes).toHaveLength(1)
  expect(validator([pad])(changedContext.solvedRoutes[0]!)).toBeTrue()
  expect(changedContext.solvedRoutes[0]!.route.some((point) => Math.abs(point.y) >= 0.25)).toBeTrue()

  // This cache already includes input roots, so changing a root requires a
  // different key rather than rebinding an otherwise identical cache entry.
  const changedRoot = new CachedIntraNodeRouteSolver({ ...base,
    nodeWithPortPoints: { ...nodeWithPortPoints, portPoints: nodeWithPortPoints.portPoints.map(
      (point) => ({ ...point, rootConnectionName: "changed-root" }),
    ) }, routeFragmentValidator: validator([]) })
  expect(changedRoot.computeCacheKeyAndTransform().cacheKey).not.toBe(cacheKey)

  cacheProvider.setCachedSolutionSync(cacheKey, { success: false, error: "another physical context failed" })
  const staleFailure = new CachedIntraNodeRouteSolver({ ...base, routeFragmentValidator: validator([]) })
  staleFailure.solve()
  expect(staleFailure.cacheHit).toBeFalse()
  expect(staleFailure.stats.physicalCacheFailureRejectionCount).toBe(1)
  expect(staleFailure.solved).toBeTrue()
  const goodEntry = cacheProvider.getCachedSolutionSync(cacheKey)
  const contextFailure = new CachedIntraNodeRouteSolver({ ...base, routeFragmentValidator: validator([pad]) })
  contextFailure.failed = true
  contextFailure.saveToCacheSync()
  expect(contextFailure.stats.physicalCacheFailureSaveSkippedCount).toBe(1)
  expect(cacheProvider.getCachedSolutionSync(cacheKey)).toEqual(goodEntry)

  const invariantFailure = new CachedIntraNodeRouteSolver({ ...base,
    routeFragmentValidator: (): boolean => { throw new Error("physical fragment invariant failed") } })
  expect(() => invariantFailure.step()).toThrow("physical fragment invariant failed")
  expect(invariantFailure.cacheHit).toBeFalse()
  expect(invariantFailure.failed).toBeTrue()
})
