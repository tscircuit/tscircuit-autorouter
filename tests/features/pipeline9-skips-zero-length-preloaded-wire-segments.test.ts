import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 skips zero-length preloaded wire segments", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fanout_trace",
    connection_name: "fanout_connection",
    route: [0, 1, 1, 2].map((x) => ({
      route_type: "wire" as const,
      x,
      y: 0,
      width: 0.1,
      layer: "top",
    })),
  }

  const routes = convertPreloadedTraceToHdRoutes(
    trace,
    0,
    4,
    0.3,
    new ConnectivityMap({ fanout_connection: [] }),
  )

  expect(routes).toHaveLength(2)
  expect(
    routes.map(({ preloadedRoutePositionStart, preloadedRoutePositionEnd }) => [
      preloadedRoutePositionStart,
      preloadedRoutePositionEnd,
    ]),
  ).toEqual([
    [0, 1],
    [2, 3],
  ])
})
