import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-regional-fallback-solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const createImpossibleSingleLayerNode = (): NodeWithPortPoints => {
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  return {
    capacityMeshNodeId: "impossible-single-layer-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints,
    portPointsInPairs: [
      [portPoints[0]!, portPoints[1]!],
      [portPoints[2]!, portPoints[3]!],
    ],
  }
}

test("Pipeline9 rejects invalid geometry and retries across legal layers", () => {
  const nodeWithPortPoints = createImpossibleSingleLayerNode()
  const connMap = new ConnectivityMap({})
  const sharedParams = {
    colorMap: {},
    connMap,
    obstacles: [],
    layerCount: 1,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  }
  const regularSolver = new Pipeline9HighDensitySolver({
    ...sharedParams,
    nodePortPoints: [nodeWithPortPoints],
    fixedHdRoutes: [],
  })
  regularSolver.step()
  expect(
    regularSolver.activeRegularSolver
      ?.growShrinkFallbackToInvalidGeometryOnFailure,
  ).toBeFalse()
  regularSolver.solve()
  expect(regularSolver.solved).toBeFalse()
  expect(regularSolver.failed).toBeTrue()
  expect(regularSolver.routes).toEqual([])

  const regionalSolver = new Pipeline9RegionalFallbackSolver({
    ...sharedParams,
    nodeWithPortPoints,
  })
  expect(
    regionalSolver.highDensitySolver
      .growShrinkFallbackToInvalidGeometryOnFailure,
  ).toBeFalse()
  regionalSolver.solve()
  expect(regionalSolver.solved).toBeFalse()
  expect(regionalSolver.failed).toBeTrue()
  expect(regionalSolver.getOutput()).toEqual([])

  const twoLayerSolver = new Pipeline9HighDensitySolver({
    ...sharedParams,
    nodePortPoints: [nodeWithPortPoints],
    fixedHdRoutes: [],
    layerCount: 2,
    allowedZ: [0, 1],
  })
  twoLayerSolver.solve()
  expect(twoLayerSolver.solved).toBeTrue()
  expect(twoLayerSolver.failed).toBeFalse()
  expect(twoLayerSolver.stats.fallbackNodeCount).toBe(1)
  expect(
    twoLayerSolver.routes.some((route) =>
      route.route.some((point) => point.z === 1),
    ),
  ).toBeTrue()

  const topOnlySolver = new Pipeline9HighDensitySolver({
    ...sharedParams,
    nodePortPoints: [nodeWithPortPoints],
    fixedHdRoutes: [],
    layerCount: 2,
    allowedZ: [0],
  })
  topOnlySolver.solve()
  expect(topOnlySolver.solved).toBeFalse()
  expect(topOnlySolver.failed).toBeTrue()
  expect(topOnlySolver.routes).toEqual([])
})
