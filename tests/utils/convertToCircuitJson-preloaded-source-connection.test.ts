import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("preloaded traces retain source connections omitted from point pairs", async () => {
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

  const convertedTraces = circuit.filter((e) => e.type === "pcb_trace")
  const graphics: GraphicsObject = {
    rects: circuit
      .filter((e) => e.type === "pcb_smtpad")
      .map((pad) => {
        if (pad.shape !== "rect") throw new Error("Expected rectangular pad")
        return {
          center: { x: pad.x, y: pad.y },
          width: pad.width,
          height: pad.height,
          fill: "rgba(255,0,0,0.25)",
          stroke: "red",
        }
      }),
    lines: convertedTraces.map((trace) => {
      const wires = trace.route.filter((point) => point.route_type === "wire")
      return { points: wires, strokeWidth: wires[0]!.width, strokeColor: "red" }
    }),
    texts: convertedTraces.map((trace) => {
      const wires = trace.route.filter((point) => point.route_type === "wire")
      return {
        x: (wires[0]!.x + wires.at(-1)!.x) / 2,
        y: wires[0]!.y - 0.6,
        text: `${trace.pcb_trace_id}\nsource: ${trace.source_trace_id}`,
        fontSize: 0.15,
      }
    }),
  }
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 300,
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  const aliasedCircuit = convertToCircuitJson(
    {
      ...originalSrj,
      connections: [
        {
          ...connections[0]!,
          name: "saved_pair",
          __netConnectionName: "saved_net",
          __rootConnectionNames: ["saved"],
        },
        connections[1]!,
      ],
    },
    traces,
    { originalSrj, includeOriginalConnections: true },
  )
  expect(
    aliasedCircuit.find(
      (element) =>
        element.type === "pcb_trace" && element.pcb_trace_id === "trace_saved",
    ),
  ).toMatchObject({ source_trace_id: "saved_net" })
})
