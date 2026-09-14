import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 materializes a same-position preloaded wire layer change", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "implicit_via_trace",
    connection_name: "implicit_via_connection",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner2" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "inner2" },
    ],
  }

  const routes = convertPreloadedTraceToHdRoutes(
    trace,
    0,
    4,
    0.45,
    new ConnectivityMap({ implicit_via_connection: [] }),
  )

  expect(routes).toHaveLength(3)
  expect(routes[1]).toMatchObject({
    preloadedRoutePositionStart: 1,
    preloadedRoutePositionEnd: 2,
    route: [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 2 },
    ],
    vias: [{ x: 1, y: 0 }],
  })
  expect(routes[0]!.route.at(-1)).toEqual(routes[1]!.route[0])
  expect(routes[1]!.route.at(-1)).toEqual(routes[2]!.route[0])
})
