import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { IntraNodePhysicalClearanceContext } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import { createPhysicalPortfolioParams } from "tests/solvers/fixtures/createPhysicalPortfolioParams"

type SolverParams = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]

test("outer portfolio and native caches both distinguish exact physical query inputs", (): void => {
  const params = createPhysicalPortfolioParams()
  const context = params.physicalClearanceContext
  const node = params.nodeWithPortPoints
  const changedIndex = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0.5 },
        width: 0.25,
        height: 0.125,
        ccwRotationDegrees: 45,
        zLayers: [0],
        ownerNetIds: new Set(["foreign"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.1,
  })
  const changedContexts: IntraNodePhysicalClearanceContext[] = [
    { ...context, traceToTraceClearance: 0.1001 },
    { ...context, viaToTraceClearance: 0.1001 },
    { ...context, traceClearanceIndex: changedIndex },
    { ...context, viaClearanceIndex: changedIndex },
    { ...context, traceClearanceIndex: context.viaClearanceIndex },
    {
      ...context,
      canonicalNetIdByConnectionName: new Map([["signal", "different-net"]]),
    },
    {
      ...context,
      solveToPhysicalTransform: { center: { x: 0.0001, y: 0 }, scale: 1 },
    },
    {
      ...context,
      solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1.0001 },
    },
  ]
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["signal", "electrically-connected-alias"]])
  const changedParams: SolverParams[] = [
    { ...params, physicalClearanceContext: undefined },
    { ...params, traceWidth: 0.1501 },
    { ...params, viaDiameter: 0.3001 },
    { ...params, obstacleMargin: 0.1001 },
    { ...params, layerCount: 3 },
    { ...params, connMap },
    { ...params, nodeWithPortPoints: { ...node, width: 2.0001 } },
    { ...params, nodeWithPortPoints: { ...node, height: 2.0001 } },
    {
      ...params,
      nodeWithPortPoints: { ...node, center: { x: 0.0001, y: 0 } },
    },
    {
      ...params,
      nodeWithPortPoints: {
        ...node,
        portPoints: node.portPoints.map((point, index) =>
          index === 0 ? { ...point, x: point.x + 0.0001 } : point,
        ),
      },
    },
    ...changedContexts.map((physicalClearanceContext) => ({
      ...params,
      physicalClearanceContext,
    })),
  ]
  for (const Solver of [
    CachedIntraNodeRouteSolver,
    CachedPortfolioSingleIntraNodeSolver,
  ]) {
    const baselineKey = new Solver(params).computeCacheKeyAndTransform()
      .cacheKey
    for (const changed of changedParams) {
      const solver = new Solver(changed)
      expect(solver.computeCacheKeyAndTransform().cacheKey).not.toBe(
        baselineKey,
      )
      expect(solver.iterations).toBe(0)
    }
    const equivalent = new Solver({
      ...params,
      physicalClearanceContext: {
        ...context,
        traceClearanceIndex: new FixedCopperClearanceIndex({
          rectangles: [],
          layerCount: 2,
          minClearance: 0.1,
        }),
        canonicalNetIdByConnectionName: new Map([["signal", "net-signal"]]),
      },
    })
    expect(equivalent.computeCacheKeyAndTransform().cacheKey).toBe(baselineKey)
    const legacy = new Solver({
      ...params,
      physicalClearanceContext: undefined,
    })
    const legacyRoundedWidth = new Solver({
      ...params,
      physicalClearanceContext: undefined,
      traceWidth: 0.1501,
    })
    expect(legacy.computeCacheKeyAndTransform().cacheKey).toBe(
      legacyRoundedWidth.computeCacheKeyAndTransform().cacheKey,
    )
  }
})
