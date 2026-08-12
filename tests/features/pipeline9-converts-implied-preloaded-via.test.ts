import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  convertPreloadedTraceToHdRoutes,
  materializeImpliedViasInPreloadedTraces,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 connects a legacy preloaded layer change through an implied via", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preloaded_trace",
    connection_name: "connection",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
    ],
  }

  const routes = convertPreloadedTraceToHdRoutes(
    trace,
    0,
    2,
    0.3,
    new ConnectivityMap({}),
  )

  expect(routes.map((route) => route.route)).toEqual([
    [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ],
    [
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ],
  ])
  expect(routes[1]!.vias).toEqual([{ x: 1, y: 0 }])
  expect(
    materializeImpliedViasInPreloadedTraces(
      {
        layerCount: 2,
        minTraceWidth: 0.1,
        obstacles: [],
        connections: [],
        bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
        traces: [trace],
      },
      0.3,
      0.15,
    ).traces?.[0]?.route,
  ).toEqual([
    { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
    { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    {
      route_type: "via",
      x: 1,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.3,
      via_hole_diameter: 0.15,
    },
    { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
    { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
  ])
})
