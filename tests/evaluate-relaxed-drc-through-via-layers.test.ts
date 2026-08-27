import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC preserves legacy via spans and expands role-aware through vias", () => {
  const createSrj = (
    allowBlindAndBuriedVias?: boolean,
    roleAware = false,
  ): SimpleRouteJson => ({
    layerCount: 4,
    ...(allowBlindAndBuriedVias === undefined
      ? {}
      : { allowBlindAndBuriedVias }),
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: roleAware
      ? [
          {
            type: "rect",
            obstacleId: "board_keepout",
            obstacleRole: "keepout",
            center: { x: 1.5, y: 1.5 },
            width: 0.1,
            height: 0.1,
            layers: ["top"],
            connectedTo: [],
          },
        ]
      : [],
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
  const evaluate = (allowBlindAndBuriedVias?: boolean, roleAware = false) => {
    const inputSrj = createSrj(allowBlindAndBuriedVias, roleAware)
    return evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: inputSrj,
      routedTraces,
    })
  }

  const throughViaResult = evaluate(false)
  const roleAwareDefaultResult = evaluate(undefined, true)
  const legacyDefaultResult = evaluate()
  const blindViaResult = evaluate(true)
  const throughVia = throughViaResult.circuitJson.find(
    (element) => element.type === "pcb_via",
  )
  const blindVia = blindViaResult.circuitJson.find(
    (element) => element.type === "pcb_via",
  )
  const roleAwareDefaultVia = roleAwareDefaultResult.circuitJson.find(
    (element) => element.type === "pcb_via",
  )
  const legacyDefaultVia = legacyDefaultResult.circuitJson.find(
    (element) => element.type === "pcb_via",
  )

  expect(throughVia).toMatchObject({
    layers: ["top", "inner1", "inner2", "bottom"],
  })
  expect(roleAwareDefaultVia).toMatchObject({
    layers: ["top", "inner1", "inner2", "bottom"],
  })
  expect(legacyDefaultVia).toMatchObject({ layers: ["top", "inner1"] })
  expect(blindVia).toMatchObject({ layers: ["top", "inner1"] })
  expect(
    throughViaResult.errors.some(
      (error) =>
        error.type === "pcb_trace_error" &&
        error.pcb_trace_error_id === "overlap_bottom_trace_via_0",
    ),
  ).toBe(true)
  expect(roleAwareDefaultResult.errors).toEqual(throughViaResult.errors)
  expect(legacyDefaultResult.errors).toHaveLength(0)
  expect(blindViaResult.errors).toHaveLength(0)
})
