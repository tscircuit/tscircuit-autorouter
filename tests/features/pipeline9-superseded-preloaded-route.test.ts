import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimplifiedPcbTrace } from "lib/types"

test("reconnects a replacement that supersedes a contained fixed primitive", () => {
  const preloadedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fanout:breakout:pcb_breakout_point_68:source-0",
    connection_name: "breakout:pcb_breakout_point_68",
    route: [
      { route_type: "wire", x: 5, y: 20.1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 5, y: 19.299, width: 0.1, layer: "top" },
      { route_type: "wire", x: 5, y: 19.299, width: 0.1, layer: "top" },
      { route_type: "wire", x: 5, y: 17.45, width: 0.1, layer: "top" },
    ],
  }
  const connMap = new ConnectivityMap({})
  const originalFixedRoutes = convertPreloadedTraceToHdRoutes(
    preloadedTrace,
    0,
    2,
    0.45,
    connMap,
  )
  const replacement = {
    ...originalFixedRoutes[0]!,
    preloadedRoutePositionEnd: 3,
    route: [
      { x: 5, y: 20.1, z: 0 },
      { x: 4.8, y: 18.7, z: 0 },
      { x: 5, y: 17.45, z: 0 },
    ],
  }

  const result = applyFixedRouteReplacementsToPreloadedTraces({
    originalTraces: [preloadedTrace],
    originalFixedRoutes,
    updatedFixedRoutes: [replacement, originalFixedRoutes[1]!],
    replacedConnectionNames: new Set([replacement.connectionName]),
    layerCount: 2,
    defaultViaHoleDiameter: 0.2,
    obstacles: [],
    connMap,
  })

  expect(result.mutatedPreloadedTraces).toHaveLength(1)
  expect(result.updatedPreloadedTraces[0]?.route).toEqual([
    { route_type: "wire", x: 5, y: 20.1, width: 0.1, layer: "top" },
    { route_type: "wire", x: 4.8, y: 18.7, width: 0.1, layer: "top" },
    { route_type: "wire", x: 5, y: 17.45, width: 0.1, layer: "top" },
  ])
})
