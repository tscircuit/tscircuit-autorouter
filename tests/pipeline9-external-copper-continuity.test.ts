import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("continuity honors existing copper without hiding a disconnected routed endpoint", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -1, minY: -1, maxX: 7, maxY: 1 },
    obstacles: [0, 3, 6].map((x, index) => ({
      type: "rect",
      center: { x, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: [`pcb_port_${index}`, `pcb_smtpad_${index}`],
    })),
    connections: [
      {
        name: "signal",
        pointsToConnect: [0, 3, 6].map((x, index) => ({
          x,
          y: 0,
          layer: "top",
          pointId: `point_${index}`,
          pcb_port_id: `pcb_port_${index}`,
        })),
        externallyConnectedPointIds: [["point_0", "point_1"]],
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "routed_signal",
    connection_name: "signal",
    route: [3, 6].map((x) => ({
      route_type: "wire",
      x,
      y: 0,
      layer: "top",
      width: 0.2,
    })),
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: input,
  })
  expect(evaluate([trace]).errors).toEqual([])

  const withoutExistingCopper = structuredClone(input)
  withoutExistingCopper.connections[0]!.externallyConnectedPointIds = []
  const missingExistingCopper = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: withoutExistingCopper,
    srjWithPointPairs: withoutExistingCopper,
  })([trace]).errors
  expect(
    missingExistingCopper.some((error) =>
      String(error.pcb_trace_error_id).includes("missing_connection"),
    ),
  ).toBe(true)

  const disconnected = structuredClone(trace)
  const endpoint = disconnected.route[0]!
  if (endpoint.route_type !== "wire") {
    throw new Error("Expected a wire endpoint")
  }
  endpoint.x = 4
  expect(
    evaluate([disconnected]).errors.some((error) =>
      String(error.pcb_trace_error_id).includes("missing_connection"),
    ),
  ).toBe(true)
})
