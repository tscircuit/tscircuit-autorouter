import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 native DRC keeps the reference repair center for parallel trace pairs", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "a",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_a_start" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_a_end" },
        ],
      },
      {
        name: "b",
        pointsToConnect: [
          { x: -0.5, y: 0.15, layer: "top", pcb_port_id: "pcb_port_b_start" },
          { x: 1.5, y: 0.15, layer: "top", pcb_port_id: "pcb_port_b_end" },
        ],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = srj.connections.map((connection) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${connection.name}`,
    connection_name: connection.name,
    route: connection.pointsToConnect.map((point, index) => ({
      route_type: "wire",
      x: point.x,
      y: point.y,
      width: 0.1,
      layer: "top",
      ...(index === 0
        ? { start_pcb_port_id: point.pcb_port_id }
        : { end_pcb_port_id: point.pcb_port_id }),
    })),
  }))
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const reference = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
  })
  const result = evaluate(traces)
  expect(reference.errors).toHaveLength(1)
  expect(result.errors).toHaveLength(1)
  expect(reference.errorsWithCenters[0]?.center).toEqual({ x: -0.5, y: 0.075 })
  expect(result.errors[0]).toMatchObject({
    pcb_trace_id: "trace_a",
    pcb_trace_error_id: "overlap_trace_a_trace_b",
    pcb_port_ids: [
      "pcb_port_a_start",
      "pcb_port_a_end",
      "pcb_port_b_start",
      "pcb_port_b_end",
    ],
    center: reference.errorsWithCenters[0]?.center,
  })
  expect(result.errorsWithCenters as unknown[]).toEqual(
    reference.errorsWithCenters as unknown[],
  )

  const separated = [
    traces[0]!,
    {
      ...traces[1]!,
      route: traces[1]!.route.map((point) => ({ ...point, y: 0.3 })),
    },
  ]
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: separated,
    }).errors,
  ).toHaveLength(0)
  expect(evaluate(separated).errors).toHaveLength(0)
})
