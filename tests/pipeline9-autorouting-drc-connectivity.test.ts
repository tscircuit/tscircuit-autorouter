import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/create-pipeline9-autorouting-drc-evaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 native DRC rebuilds endpoint connectivity for every candidate", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [{
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: -1 },
      width: 0.4,
      height: 0.4,
      connectedTo: ["pcb_smtpad_sibling", "pcb_port_sibling", "net"],
    }],
    connections: [{
      name: "net",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_start" },
        { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_end" },
        { x: 0, y: -1, layer: "top", pcb_port_id: "pcb_port_sibling" },
      ],
    }],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...originalSrj,
    connections: [
      {
        name: "horizontal",
        __netConnectionName: "net",
        pointsToConnect: originalSrj.connections[0]!.pointsToConnect.slice(0, 2),
      },
      { name: "vertical", pointsToConnect: [] },
    ],
  }
  const horizontal: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "horizontal_trace",
    connection_name: "horizontal",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const vertical: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "vertical_trace",
    connection_name: "vertical",
    route: [
      { route_type: "wire", x: 0, y: -0.5, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ],
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    originalSrj,
    srjWithPointPairs,
  })
  const disconnected = [horizontal, vertical]
  const reference = evaluateRelaxedDrc({
    inputSrj: originalSrj,
    srjWithPointPairs,
    routedTraces: disconnected,
  })
  const initial = evaluate(disconnected)
  const referencePairs = reference.errors.filter((error) =>
    "pcb_trace_error_id" in error && error.pcb_trace_error_id.startsWith("overlap_"),
  )
  const initialPairs = initial.errors.filter((error) =>
    String(error.pcb_trace_error_id).startsWith("overlap_"),
  )
  expect(referencePairs).toHaveLength(1)
  expect(initialPairs).toHaveLength(1)
  expect(initialPairs[0]).toMatchObject({
    pcb_trace_id: "horizontal_trace",
    pcb_trace_error_id: "overlap_horizontal_trace_vertical_trace",
    center: { x: 0, y: 0 },
  })
  expect(initial.errorsWithCenters[0]?.center).toEqual(
    reference.errorsWithCenters[0]?.center,
  )
  expect(initial.errorsWithCenters as unknown[]).toEqual(
    reference.errorsWithCenters as unknown[],
  )

  const connected = [horizontal, {
    ...vertical,
    route: [
      { route_type: "wire" as const, x: 0, y: -1, width: 0.1, layer: "top" },
      vertical.route[1]!,
    ],
  }]
  const connectedReference = evaluateRelaxedDrc({
    inputSrj: originalSrj,
    srjWithPointPairs,
    routedTraces: connected,
  })
  expect(connectedReference.errors.filter((error) =>
    "pcb_trace_error_id" in error && error.pcb_trace_error_id.startsWith("overlap_"),
  )).toHaveLength(0)
  expect(evaluate(connected).errors.filter((error) =>
    String(error.pcb_trace_error_id).startsWith("overlap_"),
  )).toHaveLength(0)
  expect(evaluate(connected).errorsWithCenters as unknown[]).toEqual(
    connectedReference.errorsWithCenters as unknown[],
  )
  expect(evaluate(disconnected).errors).toEqual(initial.errors)
})
