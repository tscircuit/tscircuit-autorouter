import { expect, test } from "bun:test"
import { doesSegmentIntersectRect } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

const startPort = {
  x: -2,
  y: 0,
  z: 0,
  connectionName: "new-route",
  rootConnectionName: "new-root",
}
const endPort = {
  x: 2,
  y: 0,
  z: 0,
  connectionName: "new-route",
  rootConnectionName: "new-root",
}
const node: NodeWithPortPoints = {
  capacityMeshNodeId: "local-node",
  center: { x: 0, y: 0 },
  width: 6,
  height: 6,
  availableZ: [0, 1],
  portPoints: [startPort, endPort],
  portPointsInPairs: [[startPort, endPort]],
}

const createFixedRoute = (
  route: PreloadedHighDensityRoute["route"],
  overrides: Partial<PreloadedHighDensityRoute> = {},
): PreloadedHighDensityRoute => ({
  connectionName: "fixed-trace",
  rootConnectionName: "fixed-root",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route,
  vias: [],
  preloadedTraceIndex: 0,
  preloadedRouteIndex: 0,
  ...overrides,
})

const createSolver = (
  fixedHdRoutes: PreloadedHighDensityRoute[],
  options: {
    node?: NodeWithPortPoints
    obstacles?: Obstacle[]
    layerCount?: number
  } = {},
): Pipeline9HighDensitySolver =>
  new Pipeline9HighDensitySolver({
    nodePortPoints: [options.node ?? node],
    fixedHdRoutes,
    connMap: new ConnectivityMap({
      "new-root": ["new-route"],
      "fixed-root": ["fixed-trace"],
    }),
    obstacles: options.obstacles ?? [
      {
        obstacleId: "board-pad",
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 1, y: 0 },
        width: 0.5,
        height: 2,
        connectedTo: ["board-pad-net"],
      },
    ],
    layerCount: options.layerCount ?? 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
  })

test("Pipeline9 selects the detailed solver by local preload overlap", () => {
  const distantPreloadSolver = createSolver([
    createFixedRoute([
      { x: -5, y: -5, z: 0 },
      { x: -5, y: 5, z: 0 },
    ]),
  ])
  const crossingPreloadSolver = createSolver([
    createFixedRoute([
      { x: 0, y: -5, z: 0 },
      { x: 0, y: 5, z: 0 },
    ]),
  ])

  distantPreloadSolver.step()
  crossingPreloadSolver.step()

  expect(distantPreloadSolver.activeRegularSolver).not.toBeNull()
  expect(distantPreloadSolver.activeB01Solver).toBeNull()
  expect(distantPreloadSolver.stats).toMatchObject({
    fixedObstacleCount: 1,
    fixedObstacleUses: 0,
    boardObstacleUses: 0,
    regularNodeCount: 1,
    b01NodeCount: 0,
  })
  expect(crossingPreloadSolver.activeRegularSolver).toBeNull()
  expect(crossingPreloadSolver.activeB01Solver).not.toBeNull()
  expect(crossingPreloadSolver).toBeInstanceOf(Pipeline9HighDensitySolver)
  expect(crossingPreloadSolver.activeB01Solver?.obstacles).toEqual([
    expect.objectContaining({
      type: "route",
      connectionName: "fixed-trace",
    }),
    expect.objectContaining({
      type: "rect",
      connectionName: "board-pad-net",
      center: { x: 1, y: 0 },
      width: 0.5,
      height: 2,
      zLayers: [0, 1],
    }),
  ])
  expect(crossingPreloadSolver.stats).toMatchObject({
    fixedObstacleCount: 1,
    fixedObstacleUses: 1,
    boardObstacleUses: 1,
    regularNodeCount: 0,
    b01NodeCount: 1,
  })

  distantPreloadSolver.solve()
  expect(distantPreloadSolver.solved).toBeTrue()
  expect(distantPreloadSolver.failed).toBeFalse()
  expect(distantPreloadSolver.routes).toHaveLength(1)
  expect(distantPreloadSolver.routes[0]!.connectionName).toBe("new-route")

  crossingPreloadSolver.solve()
  expect(crossingPreloadSolver.solved).toBeTrue()
  expect(crossingPreloadSolver.failed).toBeFalse()
  expect(crossingPreloadSolver.routes).toHaveLength(1)
  expect(crossingPreloadSolver.failedSolvers).toEqual([])
  const crossingRoute = crossingPreloadSolver.routes[0]!
  expect(
    crossingRoute.route.slice(0, -1).some((point, pointIndex) =>
      doesSegmentIntersectRect(point, crossingRoute.route[pointIndex + 1]!, {
        minX: 0.75,
        maxX: 1.25,
        minY: -1,
        maxY: 1,
      }),
    ),
  ).toBeFalse()
  expect(crossingRoute.route.some(({ z }) => z === 1)).toBe(true)

  const singleLayerNode: NodeWithPortPoints = {
    ...node,
    width: 4,
    height: 4,
    availableZ: [0],
    portPoints: [startPort, endPort],
    portPointsInPairs: [[startPort, endPort]],
  }
  const fixedViaSolver = createSolver(
    [
      createFixedRoute(
        [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
        ],
        { viaDiameter: 0.6, vias: [{ x: 0, y: 0 }] },
      ),
    ],
    { node: singleLayerNode, obstacles: [] },
  )
  fixedViaSolver.step()
  expect(fixedViaSolver.activeRegularSolver).toBeNull()
  expect(fixedViaSolver.activeB01Solver).not.toBeNull()
  expect(fixedViaSolver.stats.fixedObstacleUses).toBe(1)
  fixedViaSolver.solve()
  expect(fixedViaSolver.solved).toBeTrue()
  expect(fixedViaSolver.failed).toBeFalse()
  expect(
    fixedViaSolver.routes[0]!.route.slice(0, -1).every(
      (point, pointIndex) =>
        minimumDistanceBetweenSegments(
          point,
          fixedViaSolver.routes[0]!.route[pointIndex + 1]!,
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ) > 0.3,
    ),
  ).toBeTrue()

  const fourLayerTopNode: NodeWithPortPoints = {
    ...singleLayerNode,
    capacityMeshNodeId: "four-layer-top-node",
  }
  const innerLayerViaSolver = createSolver(
    [
      createFixedRoute(
        [
          { x: 0, y: 0, z: 2 },
          { x: 0, y: 0, z: 3 },
        ],
        { viaDiameter: 0.6, vias: [{ x: 0, y: 0 }] },
      ),
    ],
    { node: fourLayerTopNode, obstacles: [], layerCount: 4 },
  )
  innerLayerViaSolver.step()
  expect(innerLayerViaSolver.activeRegularSolver).not.toBeNull()
  expect(innerLayerViaSolver.activeB01Solver).toBeNull()
  expect(innerLayerViaSolver.stats).toMatchObject({
    fixedObstacleUses: 0,
    regularNodeCount: 1,
    b01NodeCount: 0,
  })

  const allLayerNode: NodeWithPortPoints = {
    ...node,
    capacityMeshNodeId: "four-layer-all-layer-node",
    availableZ: [0, 1, 2, 3],
  }
  const buriedViaSolver = createSolver(
    [
      createFixedRoute(
        [
          { x: 0, y: 0, z: 2 },
          { x: 0, y: 0, z: 3 },
        ],
        { viaDiameter: 0.6, vias: [{ x: 0, y: 0 }] },
      ),
    ],
    { node: allLayerNode, obstacles: [], layerCount: 4 },
  )
  buriedViaSolver.step()
  expect(buriedViaSolver.activeRegularSolver).toBeNull()
  expect(buriedViaSolver.activeB01Solver?.obstacles).toContainEqual(
    expect.objectContaining({
      type: "route",
      vias: [{ x: 0, y: 0, zStart: 2, zEnd: 3 }],
    }),
  )
  buriedViaSolver.solve()
  expect(buriedViaSolver.solved).toBeTrue()
  expect(buriedViaSolver.failed).toBeFalse()
  expect(buriedViaSolver.routes[0]!.route.every(({ z }) => z === 0)).toBeTrue()
  expect(
    Math.min(
      ...buriedViaSolver.routes[0]!.route.slice(0, -1).map(
        (point, pointIndex) =>
          minimumDistanceBetweenSegments(
            point,
            buriedViaSolver.routes[0]!.route[pointIndex + 1]!,
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ),
      ),
    ),
  ).toBeLessThan(1e-9)

  const compactNode: NodeWithPortPoints = {
    ...node,
    width: 2,
    height: 2,
    portPoints: [
      { ...startPort, x: -1 },
      { ...endPort, x: 1 },
    ],
    portPointsInPairs: [
      [
        { ...startPort, x: -1 },
        { ...endPort, x: 1 },
      ],
    ],
  }
  const nearbyAabbOnlySolver = createSolver(
    [
      createFixedRoute([
        { x: -2, y: 1.44, z: 0 },
        { x: 1.44, y: 3, z: 0 },
      ]),
    ],
    { node: compactNode, obstacles: [] },
  )
  nearbyAabbOnlySolver.step()
  expect(nearbyAabbOnlySolver.activeRegularSolver).not.toBeNull()
  expect(nearbyAabbOnlySolver.activeB01Solver).toBeNull()
  expect(nearbyAabbOnlySolver.stats.fixedObstacleUses).toBe(0)

  const rotatedObstacleSolver = createSolver(
    [
      createFixedRoute([
        { x: 0, y: -2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ]),
    ],
    {
      node: compactNode,
      obstacles: [
        {
          obstacleId: "rotated-pad",
          type: "rect",
          layers: ["top"],
          center: { x: 2.5, y: 0 },
          width: 2,
          height: 2,
          ccwRotationDegrees: 45,
          connectedTo: ["rotated-pad-net"],
        },
      ],
    },
  )
  rotatedObstacleSolver.step()
  expect(rotatedObstacleSolver.activeB01Solver?.obstacles).toContainEqual(
    expect.objectContaining({
      type: "rect",
      connectionName: "rotated-pad-net",
      ccwRotationDegrees: 45,
    }),
  )
  expect(rotatedObstacleSolver.stats.boardObstacleUses).toBe(1)
})
