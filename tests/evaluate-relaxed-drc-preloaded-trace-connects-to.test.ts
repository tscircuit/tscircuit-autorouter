import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("relaxed DRC connects a preloaded fanout trace to its own pad", () => {
  const fanoutTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fanout:breakout:point_0",
    connection_name: "breakout:point_0",
    connectsTo: ["breakout:point_0", "pcb_port_0", "pcb_port_0"],
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "pcb_port_0",
      },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_0", "pcb_port_0"],
      },
    ],
    connections: [
      {
        name: "routed_connection",
        pointsToConnect: [
          {
            x: 1,
            y: 0,
            layer: "top",
            pointId: "breakout:point_0",
          },
          { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
        ],
      },
    ],
    traces: [fanoutTrace],
  }
  const routedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "routed_trace",
    connection_name: "routed_connection",
    route: [
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "wire",
        x: 2,
        y: 0,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "pcb_port_1",
      },
    ],
  }

  const { errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces: [routedTrace],
  })
  expect(errors).toHaveLength(0)
})

test("relaxed DRC accepts preloaded trace endpoints on their declared pad edges", () => {
  const padHeight = 0.6604
  const firstPadY = 0
  const secondPadY = 1.0414
  const edgeTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "pcb_trace_edge_to_edge",
    connection_name: "source_net_0",
    connectsTo: ["pcb_port_0", "pcb_port_1"],
    route: [
      {
        route_type: "wire",
        x: 0,
        y: firstPadY + padHeight / 2,
        width: 0.3175,
        layer: "bottom",
      },
      {
        route_type: "wire",
        x: 0,
        y: secondPadY - padHeight / 2,
        width: 0.3175,
        layer: "bottom",
      },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: firstPadY },
        width: 1.27,
        height: padHeight,
        connectedTo: ["pcb_smtpad_0", "pcb_port_0", "source_net_0"],
        circuitJsonMetadata: { pcb_port_id: "pcb_port_0" },
      },
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: secondPadY },
        width: 1.27,
        height: padHeight,
        connectedTo: ["pcb_smtpad_1", "pcb_port_1", "source_net_0"],
        circuitJsonMetadata: { pcb_port_id: "pcb_port_1" },
      },
    ],
    connections: [
      {
        name: "source_net_0",
        pointsToConnect: [
          {
            x: 0,
            y: firstPadY,
            layer: "bottom",
            pcb_port_id: "pcb_port_0",
          },
          {
            x: 0,
            y: secondPadY,
            layer: "bottom",
            pcb_port_id: "pcb_port_1",
          },
        ],
      },
    ],
    traces: [edgeTrace],
  }

  const { errors } = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    routedTraces: [],
    normalizePreloadedTracePadEdgeEndpoints: true,
  })

  expect(errors).toHaveLength(0)

  const separatedTrace: SimplifiedPcbTrace = {
    ...edgeTrace,
    route: edgeTrace.route.map((point, index) =>
      index === 0 && point.route_type === "wire"
        ? { ...point, y: point.y + 0.01 }
        : point,
    ),
  }
  const separatedInputSrj = {
    ...inputSrj,
    traces: [separatedTrace],
  }
  const separatedResult = evaluateRelaxedDrc({
    inputSrj: separatedInputSrj,
    srjWithPointPairs: separatedInputSrj,
    routedTraces: [],
    normalizePreloadedTracePadEdgeEndpoints: true,
  })
  expect(
    separatedResult.errors.some(
      (error) =>
        error.type === "pcb_trace_error" &&
        error.message.includes("pcb_port_0"),
    ),
  ).toBe(true)
})
