import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("regional trace cuts stay clear of unrelated fixed terminals", async (): Promise<void> => {
  const fixedHdRoutes: PreloadedHighDensityRoute[] = [
    {
      connectionName: "preload",
      rootConnectionName: "preload",
      preloadedTraceIndex: 0,
      preloadedRouteIndex: 0,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0.01, z: 0 },
        { x: 2, y: 0.01, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "fixed",
      rootConnectionName: "preload",
      preloadedTraceIndex: 1,
      preloadedRouteIndex: 0,
      isFixed: true,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -0.8, y: -0.7, z: 1 },
        { x: 0.8, y: -0.7, z: 1 },
      ],
      vias: [],
    },
  ]
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "region",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: [
          { x: 1, y: 0, z: 0, connectionName: "signal" },
          { x: 0, y: 1, z: 0, connectionName: "signal" },
        ],
      },
    ],
    fixedHdRoutes,
    connMap: new ConnectivityMap({ preload: ["preload", "fixed"] }),
    obstacles: [],
    layerCount: 2,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.05,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.error).toBeNull()
  expect(solver.routes).toHaveLength(1)
  expect(solver.getUpdatedFixedHdRoutes()).toContainEqual(fixedHdRoutes[1])
  for (const fixed of solver.getUpdatedFixedHdRoutes()) {
    expect(
      doPipeline9RoutesHaveCopperConflict({
        left: solver.routes[0]!,
        right: fixed,
        clearance: 0.05,
        layerCount: 2,
      }),
    ).toBeFalse()
  }

  const traces: SimplifiedPcbTrace[] = [
    ...solver.getUpdatedFixedHdRoutes(),
    ...solver.routes,
  ].map((route, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${index}`,
    connection_name: route.rootConnectionName ?? route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, 2),
  }))
  const view: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2.1, maxX: 2.1, minY: -1, maxY: 1.1 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 1, y: 0, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
      { name: "preload", pointsToConnect: [] },
    ],
    traces,
  }
  await expect(
    getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(view, { traceColorMode: "net" }),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
