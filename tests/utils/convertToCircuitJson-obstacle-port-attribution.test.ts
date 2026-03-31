import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("obstacles use the nearest pcb_port_id instead of the first connected port", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 1.2,
        height: 1.2,
        connectedTo: [
          "pcb_smtpad_0",
          "pcb_port_0",
          "pcb_smtpad_1",
          "pcb_port_1",
          "pcb_smtpad_2",
          "pcb_port_2",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 1.2,
        height: 1.2,
        connectedTo: [
          "pcb_smtpad_1",
          "pcb_port_0",
          "pcb_smtpad_1",
          "pcb_port_1",
          "pcb_smtpad_2",
          "pcb_port_2",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 2 },
        width: 1.2,
        height: 1.2,
        connectedTo: [
          "pcb_smtpad_2",
          "pcb_port_0",
          "pcb_smtpad_1",
          "pcb_port_1",
          "pcb_smtpad_2",
          "pcb_port_2",
        ],
      },
    ],
    connections: [
      {
        name: "source_trace_0",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
        ],
      },
      {
        name: "source_trace_1",
        pointsToConnect: [
          { x: 2, y: 2, layer: "top", pcb_port_id: "pcb_port_2" },
        ],
      },
    ],
  }

  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "source_trace_0_0",
      connection_name: "source_trace_0",
      route: [
        { route_type: "wire", x: -2, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "source_trace_1_0",
      connection_name: "source_trace_1",
      route: [
        { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 2, y: 2, width: 0.15, layer: "top" },
      ],
    },
  ]

  const circuitJson = convertToCircuitJson(srj, traces, srj.minTraceWidth)
  const smtPads = circuitJson.filter(
    (
      element,
    ): element is Extract<
      (typeof circuitJson)[number],
      { type: "pcb_smtpad" }
    > => element.type === "pcb_smtpad",
  )

  expect(smtPads).toHaveLength(3)
  expect(smtPads.map((pad) => pad.pcb_port_id)).toEqual([
    "pcb_port_0",
    "pcb_port_1",
    "pcb_port_2",
  ])
})
