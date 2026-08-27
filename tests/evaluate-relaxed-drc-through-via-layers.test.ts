import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC expands vias through every layer unless blind vias are enabled", () => {
  const createSrj = (allowBlindAndBuriedVias?: boolean): SimpleRouteJson => ({
    layerCount: 4,
    ...(allowBlindAndBuriedVias === undefined
      ? {}
      : { allowBlindAndBuriedVias }),
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "via_signal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "via_start" },
          { x: 1, y: 0, layer: "inner1", pcb_port_id: "via_end" },
        ],
      },
      {
        name: "bottom_signal",
        pointsToConnect: [
          { x: 0, y: -1, layer: "bottom", pcb_port_id: "bottom_start" },
          { x: 0, y: 1, layer: "bottom", pcb_port_id: "bottom_end" },
        ],
      },
    ],
  })
  const routedTraces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "via_trace",
      connection_name: "via_signal",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "via_start",
        },
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
        },
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.1,
          layer: "inner1",
        },
        {
          route_type: "wire",
          x: 1,
          y: 0,
          width: 0.1,
          layer: "inner1",
          end_pcb_port_id: "via_end",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_trace",
      connection_name: "bottom_signal",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: -1,
          width: 0.1,
          layer: "bottom",
          start_pcb_port_id: "bottom_start",
        },
        {
          route_type: "wire",
          x: 0,
          y: 1,
          width: 0.1,
          layer: "bottom",
          end_pcb_port_id: "bottom_end",
        },
      ],
    },
  ]
  const evaluate = (allowBlindAndBuriedVias?: boolean) => {
    const inputSrj = createSrj(allowBlindAndBuriedVias)
    return evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: inputSrj,
      routedTraces,
    })
  }

  const throughViaResult = evaluate(false)
  const defaultViaResult = evaluate()
  const blindViaResult = evaluate(true)
  const throughVia = throughViaResult.circuitJson.find(
    (element) => element.type === "pcb_via",
  )
  const blindVia = blindViaResult.circuitJson.find(
    (element) => element.type === "pcb_via",
  )
  const defaultVia = defaultViaResult.circuitJson.find(
    (element) => element.type === "pcb_via",
  )

  expect(throughVia).toMatchObject({
    layers: ["top", "inner1", "inner2", "bottom"],
  })
  expect(defaultVia).toMatchObject({
    layers: ["top", "inner1", "inner2", "bottom"],
  })
  expect(blindVia).toMatchObject({ layers: ["top", "inner1"] })
  expect(
    throughViaResult.errors.some(
      (error) =>
        error.type === "pcb_trace_error" &&
        error.pcb_trace_error_id === "overlap_bottom_trace_via_0",
    ),
  ).toBe(true)
  expect(defaultViaResult.errors).toEqual(throughViaResult.errors)
  expect(blindViaResult.errors).toHaveLength(0)
})
