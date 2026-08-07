import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC preserves original same-net connectivity for sibling pads", () => {
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 5, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["pcb_smtpad_start", "pcb_port_start", "net"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["pcb_smtpad_sibling", "pcb_port_sibling", "net"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 4, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["pcb_smtpad_end", "pcb_port_end", "net"],
      },
    ],
    connections: [
      {
        name: "net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_start" },
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_sibling" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "pcb_port_end" },
        ],
      },
    ],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "net_mst1",
        __netConnectionName: "net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_start" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "pcb_port_end" },
        ],
      },
    ],
  }
  const routedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "pcb_trace_net_mst1",
    connection_name: "net_mst1",
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "pcb_port_start",
      },
      {
        route_type: "wire",
        x: 4,
        y: 0,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "pcb_port_end",
      },
    ],
  }

  const { errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    routedTraces: [routedTrace],
  })
  const siblingPadContactErrors = errors.filter(
    (error) => "message" in error && error.message.includes("pcb_port_sibling"),
  )

  expect(siblingPadContactErrors).toHaveLength(0)
  expect(errors).toHaveLength(0)
})
