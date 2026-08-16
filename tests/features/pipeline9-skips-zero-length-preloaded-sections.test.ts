import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { expect, test } from "bun:test"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline 9 omits zero-length preloaded wire sections", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fanout-trace",
    connection_name: "ddr3-dq",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const connMap = new ConnectivityMap({})

  const routes = convertPreloadedTraceToHdRoutes(trace, 0, 2, 0.3, connMap)

  expect(routes).toHaveLength(1)
  expect(routes[0]!.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ])
  expect(routes[0]!.preloadedRoutePositionStart).toBe(1)
  expect(routes[0]!.preloadedRoutePositionEnd).toBe(2)
})
