import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { IntraNodePhysicalClearanceContext } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

type SolverParams = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]

test("physical cache keys include exact queries, frames, rules and canonical ownership", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "physical-cache-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 1,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -1, y: -0.5, z: 0 },
      { connectionName: "a", x: 1, y: -0.5, z: 0 },
      { connectionName: "b", x: -1, y: 0.5, z: 1 },
      { connectionName: "b", x: 1, y: 0.5, z: 1 },
    ],
  }
  const traceClearanceIndex = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.1,
  })
  const viaClearanceIndex = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.2,
  })
  const context: IntraNodePhysicalClearanceContext = {
    traceClearanceIndex,
    viaClearanceIndex,
    traceToTraceClearance: 0.1,
    viaToTraceClearance: 0.1,
    canonicalNetIdByConnectionName: new Map([
      ["a", "net-a"],
      ["b", "net-b"],
    ]),
    solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 0.5 },
  }
  const params: SolverParams = {
    nodeWithPortPoints: node,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    layerCount: 2,
    physicalClearanceContext: context,
    cacheProvider: null,
  }
  const baseline = new CachedIntraNodeRouteSolver(params)
  const baselineKey = baseline.computeCacheKeyAndTransform().cacheKey
  const equivalent = new CachedIntraNodeRouteSolver({
    ...params,
    physicalClearanceContext: {
      ...context,
      traceClearanceIndex: new FixedCopperClearanceIndex({
        rectangles: [],
        layerCount: 2,
        minClearance: 0.1,
      }),
      canonicalNetIdByConnectionName: new Map([
        ["b", "net-b"],
        ["a", "net-a"],
      ]),
    },
  })
  expect(equivalent.computeCacheKeyAndTransform().cacheKey).toBe(baselineKey)

  const shiftedNode: NodeWithPortPoints = {
    ...node,
    portPoints: node.portPoints.map((point, index) =>
      index === 0 ? { ...point, x: point.x + 0.0001 } : point,
    ),
  }
  const changedContexts: IntraNodePhysicalClearanceContext[] = [
    { ...context, traceToTraceClearance: 0.1001 },
    { ...context, viaToTraceClearance: 0.1001 },
    { ...context, traceClearanceIndex: viaClearanceIndex },
    { ...context, viaClearanceIndex: traceClearanceIndex },
    {
      ...context,
      canonicalNetIdByConnectionName: new Map([
        ["a", "net-b"],
        ["b", "net-b"],
      ]),
    },
    {
      ...context,
      solveToPhysicalTransform: { center: { x: 0.0001, y: 0 }, scale: 0.5 },
    },
    {
      ...context,
      solveToPhysicalTransform: { center: { x: 0, y: 0.0001 }, scale: 0.5 },
    },
    {
      ...context,
      solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 0.5001 },
    },
  ]
  const changedParams: SolverParams[] = [
    { ...params, physicalClearanceContext: undefined },
    { ...params, traceWidth: 0.1501 },
    { ...params, viaDiameter: 0.3001 },
    { ...params, obstacleMargin: 0.1001 },
    { ...params, layerCount: 3 },
    { ...params, nodeWithPortPoints: shiftedNode },
    { ...params, nodeWithPortPoints: { ...node, width: 2.0001 } },
    { ...params, nodeWithPortPoints: { ...node, height: 1.0001 } },
    {
      ...params,
      nodeWithPortPoints: { ...node, center: { x: 0.0001, y: 0 } },
    },
    ...changedContexts.map((physicalClearanceContext) => ({
      ...params,
      physicalClearanceContext,
    })),
  ]
  for (const changed of changedParams) {
    const solver = new CachedIntraNodeRouteSolver(changed)
    expect(solver.computeCacheKeyAndTransform().cacheKey).not.toBe(baselineKey)
    expect(solver.iterations).toBe(0)
  }

  const legacy = new CachedIntraNodeRouteSolver({
    ...params,
    physicalClearanceContext: undefined,
  })
  const legacyRoundedWidth = new CachedIntraNodeRouteSolver({
    ...params,
    physicalClearanceContext: undefined,
    traceWidth: 0.1501,
  })
  expect(legacy.computeCacheKeyAndTransform().cacheKey).toBe(
    legacyRoundedWidth.computeCacheKeyAndTransform().cacheKey,
  )
})
