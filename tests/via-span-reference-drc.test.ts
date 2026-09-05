import { expect, test } from "bun:test"
import {
  AutoroutingDrcEngine,
  type SimplifiedPcbTraces,
} from "high-density-repair03/lib"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("reference and indexed DRC check the same declared via span", () => {
  const srj = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } satisfies SimpleRouteJson
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "via_trace",
      connection_name: "via_net",
      route: [
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner2",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "signal_trace",
      connection_name: "signal_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "inner1" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner1" },
      ],
    },
  ]
  const before = structuredClone(traces)
  const engine = new AutoroutingDrcEngine(srj)
  const json = convertToCircuitJson(srj, traces)
  expect(json.find((element) => element.type === "pcb_via")?.layers).toEqual([
    "top",
    "inner1",
    "inner2",
  ])
  expect(engine.evaluate(traces).errors.length).toBeGreaterThan(0)
  expect(
    getDrcErrors(json, { includeTraceContinuity: false }).errors.length,
  ).toBeGreaterThan(0)
  expect(traces).toEqual(before)

  const via = traces[0]!.route[0]!
  if (via.route_type !== "via") throw new Error("Expected a via")
  via.layers = ["top"]
  const explicitJson = convertToCircuitJson(srj, traces)
  expect(
    explicitJson.find((element) => element.type === "pcb_via")?.layers,
  ).toEqual(["top"])
  expect(engine.evaluate(traces).errors).toEqual([])
  expect(
    getDrcErrors(explicitJson, { includeTraceContinuity: false }).errors,
  ).toEqual([])
})
