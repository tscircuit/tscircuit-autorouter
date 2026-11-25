import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"

test("a wire's endpoint label cannot assign a foreign pad to its desired net", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "start" }],
      },
      {
        name: "other",
        pointsToConnect: [
          { x: 4, y: 0, layer: "top", pcb_port_id: "other-port" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        width: 0.4,
        height: 0.4,
        center: { x: 4, y: 0 },
        layers: ["top"],
        connectedTo: ["other-port"],
        circuitJsonMetadata: {
          pcb_port_id: "other-port",
          pcb_smtpad_id: "foreign-pad",
        },
      },
    ],
  }
  const wire: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "wire",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      {
        route_type: "wire",
        x: 4,
        y: 0,
        layer: "top",
        width: 0.1,
        end_pcb_port_id: "other-port",
      },
    ],
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: srj,
    srjWithPointPairs: srj,
  })
  const { circuitJson, errors } = evaluate([wire])
  const signal = circuitJson.find(
    (e) => e.type === "source_trace" && e.source_trace_id === "signal",
  )
  expect(signal).toMatchObject({ connected_source_net_ids: ["start"] })
  expect(errors.map((e) => e.pcb_trace_error_id)).toContain(
    "disconnected_endpoint_wire_end",
  )
})
