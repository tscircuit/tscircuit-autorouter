import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("an overlapping foreign pad does not become part of the routed net", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minPadEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "top-signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "a-start" },
          { x: 2, y: 0, layer: "bottom", pcb_port_id: "a-end" },
        ],
      },
      {
        name: "bottom-signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pcb_port_id: "b-start" },
          { x: 2, y: 1, layer: "bottom", pcb_port_id: "b-end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["a-start", "top-signal"],
        circuitJsonMetadata: {
          pcb_port_id: "a-start",
          pcb_smtpad_id: "top-pad",
        },
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["bottom"],
        connectedTo: ["b-start", "bottom-signal"],
        circuitJsonMetadata: {
          pcb_port_id: "b-start",
          pcb_smtpad_id: "bottom-pad",
        },
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "routed-a",
      connection_name: "top-signal",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
  })
  expect(errors).toContainEqual(
    expect.objectContaining({
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_ids: expect.arrayContaining(["bottom-pad"]),
    }),
  )
})
