import { expect, test } from "bun:test"
import { assertTracesAvoidViaKeepouts } from "../lib/utils/assertTracesAvoidViaKeepouts"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"

test("final validation rejects repair-generated via overlaps and permits blind vias outside the forbidden stack", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [],
    viaKeepouts: [
      { shape: "circle", center: { x: 0, y: 0 }, radius: 1, layers: ["top"] },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "t",
    connection_name: "net",
    route: [
      {
        route_type: "via",
        x: 1.4,
        y: 0,
        from_layer: "inner1",
        to_layer: "bottom",
        via_diameter: 1,
      },
    ],
  }
  expect(() => assertTracesAvoidViaKeepouts([trace], srj)).toThrow(
    "Via copper overlaps",
  )
  expect(() =>
    assertTracesAvoidViaKeepouts([trace], {
      ...srj,
      allowBlindAndBuriedVias: true,
    }),
  ).not.toThrow()
  expect(() =>
    assertTracesAvoidViaKeepouts([trace], { ...srj, viaKeepouts: [] }),
  ).not.toThrow()
})
