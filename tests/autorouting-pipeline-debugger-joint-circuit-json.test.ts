import { expect, test } from "bun:test"
import { getCurrentCircuitJson } from "lib/testing/autorouting-pipeline-debugger/getCurrentCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("debugger circuit JSON includes input and routed traces", () => {
  const inputTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "input_trace",
    connection_name: "input_connection",
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
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "input_connection",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "routed_connection",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
    traces: [inputTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...originalSrj,
    connections: [originalSrj.connections[1]!],
  }

  const circuitJson = getCurrentCircuitJson({
    originalSrj,
    srjWithPointPairs,
    srj: originalSrj,
    getOutputSimplifiedPcbTraces: () => [routedTrace],
  })!
  const traceIds = circuitJson
    .filter((element) => element.type === "pcb_trace")
    .map((trace) => trace.pcb_trace_id)
    .sort()
  const traceOverlapErrors = getDrcErrors(circuitJson).errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id.startsWith("overlap_"),
  )

  expect(traceIds).toEqual(["input_trace", "routed_trace"])
  expect(traceOverlapErrors).toHaveLength(1)
})
