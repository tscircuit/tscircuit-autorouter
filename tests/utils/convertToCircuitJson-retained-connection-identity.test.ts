import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"

test("completed same-net traces retain separate phase connection identities", (): void => {
  const connections: SimpleRouteJson["connections"] = ["saved", "active"].map(
    (name, index) => ({
      name,
      pointsToConnect: [0, 1].map((offset) => ({
        x: index * 3 + offset,
        y: 0,
        layer: "top" as const,
        pcb_port_id: `${name}_${offset}`,
      })),
    }),
  )
  const traces: SimplifiedPcbTrace[] = connections.map((connection) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${connection.name}`,
    connection_name: connection.name,
    connectsTo: connection.pointsToConnect.map((point) => point.pcb_port_id!),
    route: connection.pointsToConnect.map((point) => ({
      route_type: "wire",
      x: point.x,
      y: point.y,
      width: 0.1,
      layer: "top",
    })),
  }))
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 5, maxY: 1 },
    connections: [connections[1]!],
    traces: [traces[0]!],
    obstacles: connections.flatMap((connection) =>
      connection.pointsToConnect.map((point) => ({
        type: "rect" as const,
        center: { x: point.x, y: point.y },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["saved", "active", point.pcb_port_id!],
        circuitJsonMetadata: {
          pcb_smtpad_id: `pad_${point.pcb_port_id}`,
          pcb_port_id: point.pcb_port_id,
        },
      })),
    ),
  }
  const circuit = convertToCircuitJson(input, traces)
  expect(
    circuit
      .filter((element) => element.type === "pcb_trace")
      .map((trace) => [trace.pcb_trace_id, trace.source_trace_id]),
  ).toEqual([
    ["trace_saved", "saved"],
    ["trace_active", "active"],
  ])
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: input,
  })
  expect(evaluate([traces[1]!]).errors).toEqual([])
  const disconnected = structuredClone(traces[1]!)
  const end = disconnected.route.at(-1)!
  if (end.route_type !== "wire") throw new Error("Expected wire terminal")
  end.x -= 0.6
  expect(
    evaluate([disconnected]).errors.some(
      (error) => error.type === "pcb_trace_error",
    ),
  ).toBeTrue()
})
