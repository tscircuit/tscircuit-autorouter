import { expect, test } from "bun:test"
import { getTerminalViaRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9TerminalRoutes"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("regional repair sees the emitted terminal barrels and leaves the interior via on its route", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.12,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [],
    obstacles: [],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace",
    connection_name: "GND",
    route: [
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.6,
      },
      { route_type: "wire", x: 0, y: 0, layer: "inner1", width: 0.12 },
      { route_type: "wire", x: 1, y: 0, layer: "inner1", width: 0.12 },
      {
        route_type: "via",
        x: 1,
        y: 0,
        from_layer: "inner1",
        to_layer: "inner2",
      },
      { route_type: "wire", x: 1, y: 0, layer: "inner2", width: 0.12 },
      { route_type: "wire", x: 2, y: 0, layer: "inner2", width: 0.12 },
      {
        route_type: "via",
        x: 2,
        y: 0,
        from_layer: "inner2",
        to_layer: "bottom",
        via_diameter: 0.5,
      },
    ],
  }
  const barrels = getTerminalViaRoutes([trace], srj)
  expect(barrels.map((r) => r.vias)).toEqual([
    [{ x: 0, y: 0 }],
    [{ x: 2, y: 0 }],
  ])
  expect(barrels.map((r) => r.connectionName)).toEqual(["GND", "GND"])
  expect(barrels.map((r) => r.viaDiameter)).toEqual([0.6, 0.5])
  expect(barrels.map((r) => r.route.map((p) => p.z))).toEqual([
    [0, 3],
    [0, 3],
  ])
  const blind = getTerminalViaRoutes([trace], {
    ...srj,
    allowBlindAndBuriedVias: true,
  })
  expect(blind.map((r) => r.route.map((p) => p.z))).toEqual([
    [0, 1],
    [2, 3],
  ])
})
