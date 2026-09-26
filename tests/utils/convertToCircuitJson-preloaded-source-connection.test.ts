import { expect, test } from "bun:test"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("preloaded traces retain source connections omitted from point pairs", () => {
  const connections: SimpleRouteJson["connections"] = ["saved", "new"].map(
    (name, index) => ({
      name,
      source_trace_id: name,
      pointsToConnect: [0, 1].map((offset) => ({
        x: index * 3 + offset,
        y: 0,
        layer: "top" as const,
        pcb_port_id: `${name}_${offset}`,
      })),
    }),
  )
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 5, maxY: 1 },
    connections,
    obstacles: connections.flatMap((connection) =>
      connection.pointsToConnect.map((point) => ({
        type: "rect" as const,
        center: { x: point.x, y: point.y },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["saved", "new", point.pcb_port_id!],
        circuitJsonMetadata: {
          pcb_smtpad_id: `pad_${point.pcb_port_id}`,
          pcb_port_id: point.pcb_port_id,
        },
      })),
    ),
  }
  const traces: SimplifiedPcbTrace[] = connections.map((connection) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${connection.name}`,
    connection_name: connection.name,
    route: connection.pointsToConnect.map((point) => ({
      route_type: "wire",
      x: point.x,
      y: point.y,
      width: 0.1,
      layer: "top",
    })),
  }))
  const circuit = convertToCircuitJson(
    { ...originalSrj, connections: [connections[1]!] },
    traces,
    { originalSrj, includeOriginalConnections: true },
  )
  expect(
    circuit
      .filter((element) => element.type === "pcb_trace")
      .map((trace) => [trace.pcb_trace_id, trace.source_trace_id]),
  ).toEqual([
    ["trace_saved", "saved"],
    ["trace_new", "new"],
  ])
  expect(checkTracesAreContiguous(circuit)).toEqual([])
})
