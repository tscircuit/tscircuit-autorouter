import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-fixed-route-replacements-to-preloaded-traces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 omits a duplicate preload point inside a spanning reroute", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fanout-trace",
    connection_name: "breakout",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "top" },
    ],
  }
  const connMap = new ConnectivityMap({ net: [trace.connection_name] })
  const originalFixedRoutes = convertPreloadedTraceToHdRoutes(
    trace,
    0,
    2,
    0.3,
    connMap,
  )

  expect(
    originalFixedRoutes.map((route) => [
      route.preloadedRoutePositionStart,
      route.preloadedRoutePositionEnd,
    ]),
  ).toEqual([
    [0, 1],
    [2, 3],
  ])

  const replacement = {
    ...originalFixedRoutes[0]!,
    preloadedRoutePositionEnd: 3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
  }
  const { mutatedPreloadedTraces } =
    applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces: [trace],
      originalFixedRoutes,
      updatedFixedRoutes: [replacement],
      replacedConnectionNames: new Set([replacement.connectionName]),
      layerCount: 2,
      defaultViaHoleDiameter: 0.2,
      obstacles: [],
      connMap,
    })

  expect(mutatedPreloadedTraces[0]!.route).toEqual([
    { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
    { route_type: "wire", x: 1, y: 1, width: 0.15, layer: "top" },
    { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "top" },
  ])
})
