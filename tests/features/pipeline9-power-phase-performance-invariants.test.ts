import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9HighDensitySolver.solveAsync yields to timers during serial preloaded solves", async (): Promise<void> => {
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const nodes: NodeWithPortPoints[] = Array.from({ length: 8 }, (_, index) => {
    const offsetX = index * 10
    return {
      capacityMeshNodeId: `async-yield-node-${index}`,
      center: { x: offsetX, y: 0 },
      width: 2.1,
      height: 2.1,
      availableZ: [0],
      portPoints: portPoints.map((point) => ({
        ...point,
        x: point.x + offsetX,
        connectionName: `${point.connectionName}-${index}`,
      })),
      portPointsInPairs: [
        [
          {
            ...portPoints[0]!,
            x: portPoints[0]!.x + offsetX,
            connectionName: `horizontal-${index}`,
          },
          {
            ...portPoints[1]!,
            x: portPoints[1]!.x + offsetX,
            connectionName: `horizontal-${index}`,
          },
        ],
        [
          {
            ...portPoints[2]!,
            x: portPoints[2]!.x + offsetX,
            connectionName: `vertical-${index}`,
          },
          {
            ...portPoints[3]!,
            x: portPoints[3]!.x + offsetX,
            connectionName: `vertical-${index}`,
          },
        ],
      ],
    }
  })
  const fixedHdRoutes: PreloadedHighDensityRoute[] = [
    {
      connectionName: "fixed-bottom",
      rootConnectionName: "fixed-bottom-root",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.3, y: 0, z: 1 },
        { x: 0.3, y: 0, z: 1 },
      ],
      vias: [],
      preloadedTraceIndex: 0,
      preloadedRouteIndex: 0,
    },
  ]
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: nodes,
    fixedHdRoutes,
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.2,
  })

  let timerTicks = 0
  const timer = setInterval(() => {
    timerTicks += 1
  }, 1)
  try {
    await solver.solveAsync({
      executeAsync: async (): Promise<never> => {
        throw new Error("Preloaded solveAsync must stay serial")
      },
    })
  } finally {
    clearInterval(timer)
  }

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(timerTicks).toBeGreaterThan(0)
})

test("Pipeline9HighDensitySolver spatial indexing ignores distant copper and obstacles while preserving local fallback results", (): void => {
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "spatial-index-parity-node",
    center: { x: 0, y: 0 },
    width: 2.1,
    height: 2.1,
    availableZ: [0],
    portPoints,
    portPointsInPairs: [
      [portPoints[0]!, portPoints[1]!],
      [portPoints[2]!, portPoints[3]!],
    ],
  }
  const localFixedRoute: PreloadedHighDensityRoute = {
    connectionName: "local-fixed-bottom",
    rootConnectionName: "local-fixed-bottom-root",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -0.3, y: 0, z: 1 },
      { x: 0.3, y: 0, z: 1 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
  }
  const distantFixedRoutes: PreloadedHighDensityRoute[] = Array.from(
    { length: 200 },
    (_, index) => ({
      connectionName: `distant-fixed-${index}`,
      rootConnectionName: `distant-fixed-root-${index}`,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 100 + index * 2, y: 100, z: 0 },
        { x: 101 + index * 2, y: 100, z: 0 },
      ],
      vias: [],
      preloadedTraceIndex: index + 1,
      preloadedRouteIndex: 0,
    }),
  )
  const distantObstacles: Obstacle[] = Array.from(
    { length: 200 },
    (_, index) => ({
      obstacleId: `distant-obstacle-${index}`,
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -100 - index * 2, y: -100 },
      width: 0.8,
      height: 0.8,
      connectedTo: [`distant-net-${index}`],
    }),
  )

  const localOnly = new Pipeline9HighDensitySolver({
    nodePortPoints: [structuredClone(node)],
    fixedHdRoutes: [structuredClone(localFixedRoute)],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    includeBoardObstacles: true,
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    viaToPadClearance: 0.15,
    effort: 0.1,
  })
  localOnly.solve()

  const withDistantCopper = new Pipeline9HighDensitySolver({
    nodePortPoints: [structuredClone(node)],
    fixedHdRoutes: [structuredClone(localFixedRoute), ...distantFixedRoutes],
    connMap: new ConnectivityMap({}),
    obstacles: distantObstacles,
    includeBoardObstacles: true,
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    viaToPadClearance: 0.15,
    effort: 0.1,
  })
  withDistantCopper.solve()

  expect(localOnly.solved).toBe(true)
  expect(withDistantCopper.solved).toBe(true)
  expect(withDistantCopper.routes).toEqual(localOnly.routes)
  expect(withDistantCopper.getUpdatedFixedHdRoutes()[0]).toEqual(
    localOnly.getUpdatedFixedHdRoutes()[0],
  )
  expect(withDistantCopper.stats.fixedObstacleUses).toBe(
    localOnly.stats.fixedObstacleUses,
  )
  expect(withDistantCopper.stats.boardObstacleUses).toBe(0)
})

test("GrowShrinkHighDensityIntraNodeSolver replays skipped initial scales before failing", (): void => {
  const portPoints = [
    { x: -1, y: -0.4, z: 0, connectionName: "route-a" },
    { x: 1, y: -0.4, z: 0, connectionName: "route-a" },
    { x: -1, y: 0.4, z: 0, connectionName: "route-b" },
    { x: 1, y: 0.4, z: 0, connectionName: "route-b" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "grow-shrink-replay-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints,
    portPointsInPairs: [
      [portPoints[0]!, portPoints[1]!],
      [portPoints[2]!, portPoints[3]!],
    ],
  }
  const visitedWidths: number[] = []
  const solver: GrowShrinkHighDensityIntraNodeSolver =
    new GrowShrinkHighDensityIntraNodeSolver({
      nodeWithPortPoints: node,
      initialGrowthAttempts: 1,
      maxGrowthAttempts: 2,
      layerCount: 2,
      viaDiameter: 0.3,
      traceWidth: 0.15,
      obstacleMargin: 0.15,
      effort: 0.1,
      growShrinkSolutionValidator: (routes): boolean => {
        const span = Math.max(
          ...routes.flatMap((route) =>
            route.route.map((point) => Math.abs(point.x)),
          ),
        )
        visitedWidths.push(span)
        // Reject larger scales so the solver must replay the skipped 1x prefix to succeed.
        return solver.scaleFactor === 1
      },
    })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.scaleFactor).toBe(1)
  expect(solver.growthAttempts).toBe(0)
  expect(visitedWidths.length).toBe(3)
})
