import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC always evaluates preloaded and routed traces together", () => {
  const preloadedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preloaded_trace",
    connection_name: "preloaded_connection",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const routedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "routed_trace",
    connection_name: "routed_connection",
    route: [
      { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: [
          "pcb_smtpad_preloaded_start",
          "pcb_port_preloaded_start",
          "preloaded_connection",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -1 },
        width: 0.4,
        height: 0.4,
        connectedTo: [
          "pcb_smtpad_routed_start",
          "pcb_port_routed_start",
          "routed_connection",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 1 },
        width: 0.4,
        height: 0.4,
        connectedTo: [
          "pcb_smtpad_routed_end",
          "pcb_port_routed_end",
          "routed_connection",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: [
          "pcb_smtpad_preloaded_end",
          "pcb_port_preloaded_end",
          "preloaded_connection",
        ],
      },
    ],
    connections: [
      {
        name: "preloaded_connection",
        pointsToConnect: [
          {
            x: -1,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_preloaded_start",
          },
          {
            x: 1,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_preloaded_end",
          },
        ],
      },
      {
        name: "routed_connection",
        pointsToConnect: [
          {
            x: 0,
            y: -1,
            layer: "top",
            pcb_port_id: "pcb_port_routed_start",
          },
          {
            x: 0,
            y: 1,
            layer: "top",
            pcb_port_id: "pcb_port_routed_end",
          },
        ],
      },
    ],
    traces: [preloadedTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [inputSrj.connections[1]!],
  }

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    routedTraces: [routedTrace],
  })
  const evaluatedTraceIds = circuitJson
    .filter((element) => element.type === "pcb_trace")
    .map((trace) => trace.pcb_trace_id)
    .sort()
  const traceOverlapErrors = errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id.startsWith("overlap_"),
  )

  expect(evaluatedTraceIds).toEqual(["preloaded_trace", "routed_trace"])
  expect(traceOverlapErrors).toHaveLength(1)
  expect(errors).toHaveLength(1)
})
