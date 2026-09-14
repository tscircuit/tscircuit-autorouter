import { expect, test } from "bun:test"
import type { PcbVia } from "circuit-json"
import {
  AutoroutingDrcEngine,
  type SimplifiedPcbTraces,
} from "high-density-repair03/lib"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

test("reference and indexed DRC use the same board via policy", (): void => {
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
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const before = structuredClone(traces)
  for (const allowBlindAndBuriedVias of [undefined, false, true]) {
    const srjWithViaPolicy = { ...srj, allowBlindAndBuriedVias }
    const json = convertToCircuitJson(srjWithViaPolicy, traces)
    const layers: PcbVia["layers"] = ["top", "inner1", "inner2"]
    if (!allowBlindAndBuriedVias) layers.push("bottom")
    expect(json.find((element) => element.type === "pcb_via")?.layers).toEqual(
      layers,
    )
    expect(
      new AutoroutingDrcEngine(srjWithViaPolicy).evaluate(traces).errors,
    ).toHaveLength(allowBlindAndBuriedVias ? 0 : 1)
    expect(
      getDrcErrors(json, { includeTraceContinuity: false }).errors,
    ).toHaveLength(allowBlindAndBuriedVias ? 0 : 1)
    expect(traces).toEqual(before)
  }

  const partialViaSrj = { ...srj, allowBlindAndBuriedVias: true }
  const engine = new AutoroutingDrcEngine(partialViaSrj)
  for (const point of traces[1]!.route) {
    if (point.route_type === "wire") point.layer = "inner1"
  }
  expect(engine.evaluate(traces).errors.length).toBeGreaterThan(0)

  const via = traces[0]!.route[0]!
  if (via.route_type !== "via") throw new Error("Expected a via")
  via.to_layer = "top"
  const singleLayerJson = convertToCircuitJson(partialViaSrj, traces)
  expect(
    singleLayerJson.find((element) => element.type === "pcb_via")?.layers,
  ).toEqual(["top"])
  expect(engine.evaluate(traces).errors).toEqual([])
  expect(
    getDrcErrors(singleLayerJson, { includeTraceContinuity: false }).errors,
  ).toEqual([])
})
