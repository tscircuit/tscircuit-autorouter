import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC does not treat copper-pour extents as terminal connectivity", () => {
  const inputSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["inner1"],
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        connectedTo: ["GND"],
        isCopperPour: true,
        netIsAssignable: true,
      },
    ],
    connections: [
      {
        name: "signal_a",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "a_start" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "a_end" },
        ],
      },
      {
        name: "signal_b",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top", pcb_port_id: "b_start" },
          { x: 0, y: 1, layer: "top", pcb_port_id: "b_end" },
        ],
      },
    ],
  }
  const routedTraces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      connection_name: "signal_a",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "a_start",
        },
        {
          route_type: "wire",
          x: 1,
          y: 0,
          width: 0.1,
          layer: "top",
          end_pcb_port_id: "a_end",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_b",
      connection_name: "signal_b",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: -1,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "b_start",
        },
        {
          route_type: "wire",
          x: 0,
          y: 1,
          width: 0.1,
          layer: "top",
          end_pcb_port_id: "b_end",
        },
      ],
    },
  ]

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces,
  })
  const sourceTraces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )

  expect(sourceTraces).toHaveLength(2)
  expect(
    sourceTraces.every(
      (trace) => !trace.connected_source_net_ids?.includes("GND" as never),
    ),
  ).toBe(true)
  expect(errors.map((error) => error.type)).toEqual(["pcb_trace_error"])
})
