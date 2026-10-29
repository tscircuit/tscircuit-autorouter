import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("reference DRC treats vias as through-hole unless buried vias are allowed", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const traces: SimplifiedPcbTrace[] = [
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
          layers: ["top", "inner1", "inner2"],
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_trace",
      connection_name: "other_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const originalTraces = structuredClone(traces)

  const throughHoleJson = convertToCircuitJson(srj, traces)
  expect(
    throughHoleJson.find((element) => element.type === "pcb_via")?.layers,
  ).toEqual(["top", "inner1", "inner2", "bottom"])
  expect(
    getDrcErrors(throughHoleJson, { includeTraceContinuity: false }).errors
      .length,
  ).toBeGreaterThan(0)

  const buriedJson = convertToCircuitJson(
    { ...srj, allowBlindAndBuriedVias: true },
    traces,
  )
  expect(
    buriedJson.find((element) => element.type === "pcb_via")?.layers,
  ).toEqual(["top", "inner1", "inner2"])
  expect(
    getDrcErrors(buriedJson, { includeTraceContinuity: false }).errors,
  ).toEqual([])
  expect(traces).toEqual(originalTraces)
  const convertedViaTrace = throughHoleJson.find(
    (element) =>
      element.type === "pcb_trace" && element.pcb_trace_id === "via_trace",
  )
  if (convertedViaTrace?.type !== "pcb_trace") {
    throw new Error("Expected the converted via trace")
  }
  expect(convertedViaTrace.route[0]).toMatchObject({
    from_layer: "top",
    to_layer: "inner2",
  })
})
