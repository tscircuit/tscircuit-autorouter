import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type CapturedCopper = {
  sourceSha: string
  node: NodeWithPortPoints
  routes: HighDensityIntraNodeRoute[]
  holeNode: NodeWithPortPoints
  holeRoutes: HighDensityIntraNodeRoute[]
  holeObstacles: Obstacle[]
  boardGeometry: HighDensityBoardGeometry
  layerCount: number
  traceWidth: number
  viaDiameter: number
}

test("optional admission and declared hole clearance", (): void => {
  // Actual lean raw geometry. Its winning family/scale were not captured;
  // the synthetic scale below tests the existing inverse callback contract.
  const fixture: CapturedCopper = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/pipeline9-lean-copper-candidate.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const originalInput = JSON.stringify(fixture)
  const connMap = new ConnectivityMap({})
  for (const node of [fixture.node, fixture.holeNode]) {
    for (const port of node.portPoints) {
      if (!port.rootConnectionName) throw new Error("Missing original raw root")
      connMap.addConnections([[port.connectionName, port.rootConnectionName]])
    }
  }
  const params = {
    nodeWithPortPoints: fixture.node,
    connMap,
    colorMap: {},
    viaDiameter: fixture.viaDiameter,
    traceWidth: fixture.traceWidth,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: new Map<string, number | null>(),
    obstacles: [],
    layerCount: fixture.layerCount,
    physicalViaMode: true,
  }
  const regular = createPipeline9RegularNodeSolver(params)
  // Ordinary route intersections remain editable by the existing downstream
  // force and repair stages. A declared mechanical-hole constraint is checked
  // before growth; this explicit callback exercises the optional generic API.
  expect(regular.growShrinkSolutionValidator).toBeUndefined()
  expect(regular.validateCandidatesBeforeGrowth).toBeFalse()
  const validate = (routes: HighDensityIntraNodeRoute[]): boolean => {
    for (let leftIndex = 0; leftIndex < routes.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < routes.length;
        rightIndex++
      ) {
        const left = routes[leftIndex]!
        const right = routes[rightIndex]!
        if (
          !connMap.areIdsConnected(left.connectionName, right.connectionName) &&
          doPipeline9RoutesHaveCopperConflict({
            left,
            right,
            clearance: 0,
            layerCount: fixture.layerCount,
          })
        ) {
          return false
        }
      }
    }
    return true
  }
  expect(validate(fixture.routes)).toBeFalse()
  expect(fixture.node.portPoints).toHaveLength(42)
  expect(fixture.routes).toHaveLength(22)
  expect(regular.MAX_ITERATIONS).toBe(40_000_000)
  const source62 = fixture.routes.find(
    (route) => route.connectionName === "source_net_62",
  )!
  const source6 = fixture.routes.find(
    (route) => route.connectionName === "source_net_6_mst2",
  )!
  expect(
    connMap.areIdsConnected(source62.connectionName, source6.connectionName),
  ).toBeFalse()
  expect(validate([source62, source6])).toBeFalse()
  expect(
    validate(
      [source62, source6].map((route) => ({
        ...route,
        rootConnectionName: "connectivity_net54",
      })),
    ),
  ).toBeFalse()

  const growth = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: fixture.node,
    connMap,
    traceWidth: fixture.traceWidth,
    viaDiameter: fixture.viaDiameter,
    growShrinkSolutionValidator: validate,
    validateCandidatesBeforeGrowth: true,
  })
  growth.scaleFactor = 4
  const growthBoundary = growth as unknown as { createActiveSubSolver(): void }
  growthBoundary.createActiveSubSolver()
  const inverse =
    growth.activeSubSolver?.constructorParams.candidateSolutionValidator
  if (!inverse) throw new Error("Missing inverse candidate validation")
  const expanded = [source62, source6].map((route) => ({
    ...route,
    route: route.route.map((point) => ({
      ...point,
      x: fixture.node.center.x + (point.x - fixture.node.center.x) * 4,
      y: fixture.node.center.y + (point.y - fixture.node.center.y) * 4,
    })),
    vias: route.vias.map((point) => ({
      x: fixture.node.center.x + (point.x - fixture.node.center.x) * 4,
      y: fixture.node.center.y + (point.y - fixture.node.center.y) * 4,
    })),
  }))
  expect(inverse(expanded)).toBeFalse()
  expect(growth.solved).toBeFalse()
  expect(growth.winningSolver).toBeUndefined()

  const directCallbackGrowth = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: fixture.node,
    candidateSolutionValidator: validate,
  })
  const directCallbackBoundary = directCallbackGrowth as unknown as {
    createActiveSubSolver(): void
  }
  directCallbackBoundary.createActiveSubSolver()
  expect(
    directCallbackGrowth.activeSubSolver?.constructorParams
      .candidateSolutionValidator,
  ).toBe(validate)

  const cache = new InMemoryCache()
  const portfolioParams = {
    nodeWithPortPoints: fixture.node,
    connMap,
    traceWidth: fixture.traceWidth,
    viaDiameter: fixture.viaDiameter,
    cacheProvider: cache,
  }
  // A genuine completed cache-hit child reaches the same public selected-child
  // hook as a searched candidate; no native winner/solved flags are fabricated.
  const cachedChild = new CachedIntraNodeRouteSolver(portfolioParams)
  cache.setCachedSolutionSync(
    cachedChild.computeCacheKeyAndTransform().cacheKey,
    { success: true, solvedRoutes: fixture.routes },
  )
  expect(cachedChild.attemptToUseCacheSync()).toBeTrue()
  const selected = new PortfolioSingleIntraNodeSolver({
    ...portfolioParams,
    candidateSolutionValidator: validate,
  })
  selected.onSolve({
    solver: cachedChild,
    hyperParameters: {},
    f: 0,
    g: 0,
    h: 0,
  })
  expect(cachedChild.solved).toBeFalse()
  expect(cachedChild.failed).toBeTrue()
  expect(selected.solved).toBeFalse()
  expect(selected.failed).toBeFalse()
  expect(selected.winningSolver).toBeUndefined()
  expect(selected.solvedRoutes).toEqual([])
  const guarded = new CachedPortfolioSingleIntraNodeSolver({
    ...portfolioParams,
    candidateSolutionValidator: validate,
  })
  const legacy = new CachedPortfolioSingleIntraNodeSolver(portfolioParams)
  const key = guarded.computeCacheKeyAndTransform().cacheKey
  expect(key).toBe(legacy.computeCacheKeyAndTransform().cacheKey)
  expect(guarded.cacheProvider).toBe(cache)
  cache.setCachedSolutionSync(key, {
    success: true,
    solvedRoutes: fixture.routes,
  })
  expect(guarded.attemptToUseCacheSync()).toBeFalse()
  expect(guarded.cacheHit).toBeFalse()
  expect(guarded.solved).toBeFalse()
  expect(guarded.failed).toBeFalse()
  expect(guarded.supervisedSolvers).toBeUndefined()
  // The undefined callback preserves the original complete-cache semantics.
  expect(legacy.attemptToUseCacheSync()).toBeTrue()
  expect(legacy.cacheHit).toBeTrue()

  const safeRoute = fixture.routes.find(
    (route) => route.connectionName === "source_net_70",
  )!
  const safeNode: NodeWithPortPoints = {
    ...fixture.node,
    portPoints: fixture.node.portPoints.filter(
      (point) => point.connectionName === safeRoute.connectionName,
    ),
    portPointsInPairs: undefined,
  }
  const safe = new CachedPortfolioSingleIntraNodeSolver({
    ...portfolioParams,
    nodeWithPortPoints: safeNode,
    candidateSolutionValidator: validate,
  })
  const safeKey = safe.computeCacheKeyAndTransform().cacheKey
  cache.setCachedSolutionSync(safeKey, {
    success: true,
    solvedRoutes: [safeRoute],
  })
  expect(safe.attemptToUseCacheSync()).toBeTrue()
  expect(safe.cacheHit).toBeTrue()
  expect(safe.solvedRoutes).toEqual([safeRoute])
  const fault = new CachedPortfolioSingleIntraNodeSolver({
    ...portfolioParams,
    candidateSolutionValidator: (): boolean => {
      throw new Error("Actual validation invariant")
    },
  })
  fault.computeCacheKeyAndTransform()
  expect(() => fault.attemptToUseCacheSync()).toThrow(
    "Actual validation invariant",
  )
  expect(fault.solved).toBeFalse()

  const holeParams = {
    ...params,
    nodeWithPortPoints: fixture.holeNode,
    obstacles: fixture.holeObstacles,
    boardGeometry: fixture.boardGeometry,
  }
  const holeSolver = createPipeline9RegularNodeSolver(holeParams)
  const holeValidator = holeSolver.growShrinkSolutionValidator
  if (!holeValidator) throw new Error("Missing declared hole validator")
  expect(holeSolver.validateCandidatesBeforeGrowth).toBeTrue()
  const legacyHoleValidator = createPipeline9RegularNodeSolver({
    ...holeParams,
    physicalViaMode: false,
  }).growShrinkSolutionValidator
  if (!legacyHoleValidator) throw new Error("Missing legacy hole validator")
  const holeRoute = fixture.holeRoutes.find(
    (route) => route.connectionName === "source_net_6_mst17",
  )!
  expect(fixture.boardGeometry.minTraceToHoleEdgeClearance).toBe(0.2)
  expect(holeValidator([holeRoute])).toBeFalse()
  expect(legacyHoleValidator([holeRoute])).toBeFalse()
  const hole = fixture.holeObstacles.find(
    (obstacle) => obstacle.obstacleId === "pcb_hole_7",
  )!
  const safeHoleRoute: HighDensityIntraNodeRoute = {
    ...holeRoute,
    route: [
      { x: hole.center.x - 0.2, y: hole.center.y + 0.88, z: 0 },
      { x: hole.center.x + 0.2, y: hole.center.y + 0.88, z: 0 },
    ],
    vias: [],
  }
  expect(holeValidator([safeHoleRoute])).toBeTrue()
  expect(legacyHoleValidator([safeHoleRoute])).toBeTrue()
  expect(
    holeValidator([
      {
        ...safeHoleRoute,
        route: safeHoleRoute.route.map((point) => ({
          ...point,
          y: point.y - 0.03,
        })),
      },
    ]),
  ).toBeFalse()
  expect(JSON.stringify(fixture)).toBe(originalInput)
})
