import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { stackSvgsHorizontally } from "stack-svgs"

const multilayerEndpoint: Obstacle = {
  type: "rect",
  layers: ["top", "bottom"],
  __zLayers: [0, 1],
  center: { x: 0, y: 0 },
  width: 0.4,
  height: 0.4,
  connectedTo: ["endpoint_shortcut_net"],
}

const blockingBottomObstacle: Obstacle = {
  type: "rect",
  layers: ["bottom"],
  __zLayers: [1],
  center: { x: 0, y: 1 },
  width: 0.3,
  height: 0.6,
  connectedTo: ["blocking_net"],
}

const createRoute = (): HighDensityRoute => ({
  connectionName: "endpoint_shortcut_net",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 2, z: 0 },
    { x: 2, y: 2, z: 0 },
    { x: 2, y: 2, z: 1 },
    { x: 4, y: 2, z: 1 },
  ],
  vias: [{ x: 2, y: 2 }],
})

const createSingleRouteSolver = (
  route: HighDensityRoute,
  obstacles: Obstacle[] = [multilayerEndpoint, blockingBottomObstacle],
  otherRoutes: HighDensityRoute[] = [],
) =>
  new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", obstacles),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route, ...otherRoutes]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({
      shortcut_net: [route.connectionName],
      blocking_net: ["blocking_net"],
    }),
  })

const renderPanel = (
  graphics: GraphicsObject,
  title: string,
  detail: string,
): string => {
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "#0d1b2a",
    svgWidth: 480,
    svgHeight: 360,
    hideInlineLabels: true,
  })
  const headerHeight = 58
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  return `<svg width="480" height="418" viewBox="0 0 480 418" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" fill="#111">${title}</text><text x="16" y="43" font-family="monospace" font-size="12" fill="#444">${detail}</text><g transform="translate(0 ${headerHeight})">${svg.slice(bodyStart, bodyEnd)}</g></svg>`
}

test("reroutes from a multilayer endpoint to remove one via", () => {
  const route = createRoute()
  const solver = createSingleRouteSolver(route)

  solver.solve()

  const optimizedRoute = solver.getOptimizedHdRoute()
  expect(optimizedRoute.vias).toHaveLength(0)
  expect(optimizedRoute.route.every((point) => point.z === 1)).toBe(true)
  expect(optimizedRoute.route).not.toContainEqual({ x: 0, y: 2, z: 1 })
  expect(solver.stats.viasRemovedByEndpointGeometryShortcuts).toBe(1)
})

test("reroutes the last endpoint symmetrically", () => {
  const route = createRoute()
  route.route.reverse()
  const solver = createSingleRouteSolver(route)

  solver.solve()

  const optimizedRoute = solver.getOptimizedHdRoute()
  expect(optimizedRoute.vias).toHaveLength(0)
  expect(optimizedRoute.route.every((point) => point.z === 1)).toBe(true)
  expect(optimizedRoute.route).not.toContainEqual({ x: 0, y: 2, z: 1 })
  expect(solver.stats.viasRemovedByEndpointGeometryShortcuts).toBe(1)
})

test("runs endpoint geometry rerouting after the normal simplification loops", () => {
  const route = createRoute()
  const solver = new TraceSimplificationSolver({
    hdRoutes: [route],
    obstacles: [multilayerEndpoint, blockingBottomObstacle],
    connMap: new ConnectivityMap({
      shortcut_net: [route.connectionName],
      blocking_net: ["blocking_net"],
    }),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
  })
  const beforeGraphics = solver.visualize()

  solver.solve()

  expect(solver.simplifiedHdRoutes[0].vias).toHaveLength(0)
  expect(solver.simplificationPipelineLoops).toBe(2)
  expect(
    stackSvgsHorizontally(
      [
        renderPanel(
          beforeGraphics,
          "BEFORE • 1 VIA",
          "Copied bottom-layer geometry collides with the blocking pad.",
        ),
        renderPanel(
          solver.visualize(),
          "AFTER • 0 VIAS",
          "Clear endpoint path stays on bottom.",
        ),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})

test("can defer endpoint geometry rerouting to a later pipeline stage", () => {
  const route = createRoute()
  const solver = new TraceSimplificationSolver({
    hdRoutes: [route],
    obstacles: [multilayerEndpoint, blockingBottomObstacle],
    connMap: new ConnectivityMap({
      shortcut_net: [route.connectionName],
      blocking_net: ["blocking_net"],
    }),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
    enableEndpointViaRemoval: false,
  })

  const visitedPhases = new Set<string>()
  while (!solver.solved && !solver.failed) {
    visitedPhases.add(solver.currentPhase)
    solver.step()
  }

  expect(visitedPhases.has("final_endpoint_via_removal")).toBe(false)
  expect(solver.simplificationPipelineLoops).toBe(2)
})

test("rejects endpoint rewrites that do not reduce the explicit via count", () => {
  const route = createRoute()
  route.vias = []
  const connMap = new ConnectivityMap({
    shortcut_net: [route.connectionName],
    blocking_net: ["blocking_net"],
  })
  const solver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: [route],
    obstacles: [multilayerEndpoint, blockingBottomObstacle],
    colorMap: {},
    layerCount: 2,
    connMap,
    enableGeometryShortcuts: false,
    enableEndpointGeometryShortcuts: true,
    enableObstacleDetourShortcuts: false,
    onlyEndpointLayerChanges: true,
    onlyAcceptViaCountReduction: true,
  })

  solver.solve()

  expect(solver.getOptimizedHdRoutes()).toEqual([route])
})

test("keeps the endpoint via when alternate geometry is blocked", () => {
  const route = createRoute()
  const solver = createSingleRouteSolver(route, [
    multilayerEndpoint,
    {
      ...blockingBottomObstacle,
      center: { x: 1, y: 1 },
      width: 3.6,
      height: 1.6,
    },
  ])

  solver.solve()

  expect(solver.getOptimizedHdRoute().vias).toHaveLength(1)
  expect(solver.stats.viasRemovedByEndpointGeometryShortcuts).toBeUndefined()
})

test("checks unchanged adjacent geometry before removing the endpoint via", () => {
  const route = createRoute()
  const crossingRoute: HighDensityRoute = {
    connectionName: "crossing_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 3, y: -1, z: 1 },
      { x: 3, y: 3, z: 1 },
    ],
    vias: [],
  }
  const solver = createSingleRouteSolver(
    route,
    [multilayerEndpoint, blockingBottomObstacle],
    [crossingRoute],
  )

  solver.solve()

  expect(solver.getOptimizedHdRoute().vias).toHaveLength(1)
  expect(solver.stats.viasRemovedByEndpointGeometryShortcuts).toBeUndefined()
})
