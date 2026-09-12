import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("reference DRC respects Core's declared trace-to-pad clearance instead of benchmark defaults", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.2,
    minBoardEdgeClearance: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        center: { x: -1, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["signal_start_port", "SIGNAL"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "signal_start_pad",
          pcb_port_id: "signal_start_port",
        },
      },
      {
        type: "rect",
        center: { x: 1, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["signal_end_port", "SIGNAL"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "signal_end_pad",
          pcb_port_id: "signal_end_port",
        },
      },
      {
        type: "rect",
        center: { x: 0, y: 0.3 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: [],
        circuitJsonMetadata: { pcb_smtpad_id: "other_net_pad" },
      },
    ],
    connections: [
      {
        name: "SIGNAL",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "signal_start_port" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "signal_end_port" },
        ],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "signal_trace",
      connection_name: "SIGNAL",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "signal_start_port",
        },
        {
          route_type: "wire",
          x: 1,
          y: 0,
          width: 0.1,
          layer: "top",
          end_pcb_port_id: "signal_end_port",
        },
      ],
    },
  ]
  const result = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
    includeBoardClearance: true,
  })
  const board = result.circuitJson.find(
    (element) => element.type === "pcb_board",
  )
  expect(board).toMatchObject({
    min_trace_to_pad_edge_clearance: 0.2,
    min_board_edge_clearance: 0.3,
  })
  const coreErrors = checkPadTraceClearance(result.circuitJson)
  expect(coreErrors).toHaveLength(1)
  expect(coreErrors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "signal_trace",
    pcb_pad_id: "other_net_pad",
    minimum_clearance: 0.2,
  })
  expect(result.errors).toEqual(coreErrors)
})
