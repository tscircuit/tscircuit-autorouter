import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("keeps obstacle connectivity out of source trace endpoint expectations", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.3,
        height: 0.3,
        connectedTo: [
          "pcb_smtpad_0",
          "pcb_port_0",
          "pcb_smtpad_2",
          "pcb_port_2",
          "connectivity_net_shared",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1, y: 0 },
        width: 0.3,
        height: 0.3,
        connectedTo: ["pcb_smtpad_1", "pcb_port_1", "connectivity_net_shared"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.5, y: 0 },
        width: 0.3,
        height: 0.3,
        connectedTo: ["pcb_smtpad_2", "pcb_port_2", "connectivity_net_shared"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0.5, y: 1 },
        width: 0.3,
        height: 0.3,
        connectedTo: ["pcb_smtpad_3", "pcb_port_3"],
      },
    ],
    connections: [
      {
        name: "source_trace_main",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
        ],
      },
      {
        name: "source_trace_side",
        pointsToConnect: [
          { x: 0.5, y: 0, layer: "top", pcb_port_id: "pcb_port_2" },
          { x: 0.5, y: 1, layer: "top", pcb_port_id: "pcb_port_3" },
        ],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "source_trace_main_0",
      connection_name: "source_trace_main",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]

  const circuitJson = convertToCircuitJson(srj, traces, {
    minTraceWidth: srj.minTraceWidth,
  })
  const sourceTrace = circuitJson.find(
    (
      element,
    ): element is Extract<
      (typeof circuitJson)[number],
      { type: "source_trace" }
    > =>
      element.type === "source_trace" &&
      element.source_trace_id === "source_trace_main",
  )

  expect(sourceTrace?.connected_source_port_ids).toEqual([
    "pcb_port_0",
    "pcb_port_1",
  ])
  expect(sourceTrace?.connected_source_net_ids).toContain("pcb_port_2")
  expect(sourceTrace?.connected_source_net_ids).toContain("pcb_smtpad_2")
  expect(
    sourceTrace?.connected_source_net_ids.some((id) =>
      id.startsWith("obstacle_"),
    ),
  ).toBe(false)

  const { errors } = getDrcErrors(circuitJson)

  expect(
    errors.filter((error) => error.error_type === "pcb_trace_error"),
  ).toHaveLength(0)
  expect(
    errors.filter((error) => error.type === "pcb_pad_trace_clearance_error"),
  ).toHaveLength(0)
})
