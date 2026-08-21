import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 keeps fixed copper immutable when regional fallback opens its layer", (): void => {
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "new-layer-fixed-copper-regression",
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
  const fixedBottomRoute: PreloadedHighDensityRoute = {
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
  }
  const fixedBottomRouteBeforeSolve = structuredClone(fixedBottomRoute)
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [fixedBottomRoute],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.stats.fallbackNodeCount).toBe(1)
  expect(solver.activeFallbackFixedRouteSections.size).toBe(0)
  expect(solver.activeFallbackFixedObstacleRoutes).toEqual([fixedBottomRoute])
  expect(solver.activeFallbackSolver?.params.obstacles).toEqual([
    expect.objectContaining({
      layers: ["bottom"],
      center: { x: 0, y: 0 },
      width: 0.6,
      height: 0.1,
      connectedTo: ["fixed-bottom", "fixed-bottom-root"],
    }),
  ])
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toBe(
    'Pipeline9 regional fallback route "horizontal" conflicts with immutable fixed route "fixed-bottom"',
  )
  expect(solver.routes).toEqual([])
  expect(solver.fixedRouteReplacements.size).toBe(0)
  expect(solver.getUpdatedFixedHdRoutes()).toEqual([
    fixedBottomRouteBeforeSolve,
  ])
  expect(fixedBottomRoute).toEqual(fixedBottomRouteBeforeSolve)

  const sameNetSolver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [fixedBottomRoute],
    connMap: new ConnectivityMap({
      "shared-root": ["horizontal", "fixed-bottom"],
    }),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  })

  sameNetSolver.solve()

  expect(sameNetSolver.solved).toBeTrue()
  expect(sameNetSolver.failed).toBeFalse()
  expect(sameNetSolver.routes).toHaveLength(2)
  expect(sameNetSolver.getUpdatedFixedHdRoutes()).toEqual([
    fixedBottomRouteBeforeSolve,
  ])
})
