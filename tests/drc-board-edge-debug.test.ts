import { expect, test } from "bun:test"
import { getCurrentCircuitJson } from "lib/testing/autorouting-pipeline-debugger/getCurrentCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("debug DRC reports traces too close to the SRJ board edge", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    outline: [
      { x: -4, y: -4 },
      { x: 4, y: -4 },
      { x: 4, y: 4 },
      { x: -4, y: 4 },
    ],
    obstacles: [],
    connections: [],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "edge_trace",
      connection_name: "edge_trace",
      route: [
        { route_type: "wire", x: -1, y: 3.8, width: 0.2, layer: "top" },
        { route_type: "wire", x: 1, y: 3.8, width: 0.2, layer: "top" },
      ],
    },
  ]

  const circuitJson = getCurrentCircuitJson({
    srj,
    srjWithPointPairs: srj,
    getOutputSimplifiedPcbTraces: () => traces,
  })
  if (!circuitJson) throw new Error("Debug Circuit JSON was not created")
  const { errors, locationAwareErrors } = getDrcErrors(circuitJson, {
    includeTraceContinuity: false,
  })

  expect(circuitJson).toContainEqual(
    expect.objectContaining({
      type: "pcb_board",
      min_board_edge_clearance: 0.2,
    }),
  )
  expect(errors).toContainEqual(
    expect.objectContaining({
      pcb_trace_error_id: "trace_too_close_to_board_edge_trace_segment_0",
      pcb_trace_id: "edge_trace",
      message: expect.stringContaining("Trace too close to board edge"),
    }),
  )
  expect(locationAwareErrors).toContainEqual(
    expect.objectContaining({ center: { x: 0, y: 3.8 } }),
  )
})
