import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-fixed-route-replacements-to-preloaded-traces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import type { SimplifiedPcbTrace } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 rebuilds an HD-rerouted section around an immutable through obstacle", (): void => {
  const preloadedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "through-obstacle-preload",
    connection_name: "fixed-trace",
    connectsTo: ["fixed-start", "fixed-end"],
    route: [
      { route_type: "wire", x: -2, y: 2, width: 0.1, layer: "top" },
      { route_type: "wire", x: -1, y: 2, width: 0.1, layer: "top" },
      {
        route_type: "through_obstacle",
        start: { x: -1, y: 2 },
        end: { x: -1.2, y: 2.2 },
        from_layer: "top",
        to_layer: "bottom",
        width: 0.1,
        circuitJsonMetadata: { pcb_plated_hole_id: "plated-hole" },
      },
      { route_type: "wire", x: -1.2, y: 2.2, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: -0.3, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 0.3, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 1.2, y: 2.2, width: 0.1, layer: "bottom" },
    ],
  }
  const connMap = new ConnectivityMap({})
  const fixedRoutes = convertPreloadedTraceToHdRoutes(
    preloadedTrace,
    0,
    2,
    0.3,
    connMap,
  )
  const throughObstacleRoutes = fixedRoutes.filter(
    (route) => route.isThroughObstacle === true,
  )
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "through-obstacle-hd-reconstruction",
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
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: fixedRoutes,
    connMap,
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.fixedRouteReplacements.size).toBeGreaterThan(0)
  expect(
    [...solver.fixedRouteReplacements.keys()].every((connectionName) =>
      fixedRoutes.some(
        (route) =>
          route.connectionName === connectionName &&
          route.isThroughObstacle !== true,
      ),
    ),
  ).toBeTrue()
  const updatedFixedRoutes = solver.getUpdatedFixedHdRoutes()
  expect(
    updatedFixedRoutes.filter((route) => route.isThroughObstacle === true),
  ).toEqual(throughObstacleRoutes)

  const { updatedPreloadedTraces, mutatedPreloadedTraces } =
    applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces: [preloadedTrace],
      originalFixedRoutes: fixedRoutes,
      updatedFixedRoutes,
      replacedConnectionNames: new Set(solver.fixedRouteReplacements.keys()),
      layerCount: 2,
      defaultViaHoleDiameter: 0.15,
      obstacles: [],
      connMap,
    })
  const rebuiltTrace = updatedPreloadedTraces[0]!
  const throughObstaclePosition = rebuiltTrace.route.findIndex(
    (routePoint) => routePoint.route_type === "through_obstacle",
  )
  const throughObstacle = preloadedTrace.route[2]!
  if (throughObstacle.route_type !== "through_obstacle") {
    throw new Error("Expected the original through-obstacle primitive")
  }

  expect(mutatedPreloadedTraces).toEqual([rebuiltTrace])
  expect(rebuiltTrace.connectsTo).toEqual(preloadedTrace.connectsTo)
  expect(rebuiltTrace.route[throughObstaclePosition]).toEqual(throughObstacle)
  expect(rebuiltTrace.route[throughObstaclePosition - 1]).toMatchObject({
    route_type: "wire",
    x: throughObstacle.start.x,
    y: throughObstacle.start.y,
    layer: throughObstacle.from_layer,
  })
  expect(rebuiltTrace.route[throughObstaclePosition + 1]).toMatchObject({
    route_type: "wire",
    x: throughObstacle.end.x,
    y: throughObstacle.end.y,
    layer: throughObstacle.to_layer,
  })
})
