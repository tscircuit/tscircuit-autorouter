import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("reference DRC honors declared copper clearance independently of drill spacing", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaHoleDiameter: 0.3,
    minViaPadDiameter: 0.5,
    minViaDiameter: 0.5,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    minPadEdgeToPadEdgeClearance: 0.25,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: [],
    obstacles: [],
  }
  const traces: SimplifiedPcbTrace[] = [0, 0.7].map((x, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${index}`,
    connection_name: `net_${index}`,
    route: [
      {
        route_type: "via",
        x,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.5,
        via_hole_diameter: 0.3,
      },
    ],
  }))
  const drc = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces: traces,
    includeBoardClearance: true,
    drcOptions: {
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
      includeTraceContinuity: false,
    },
  })
  expect(drc.errors).toHaveLength(1)
  expect(drc.errors[0]).toMatchObject({
    type: "pcb_via_clearance_error",
    minimum_clearance: 0.25,
  })
  const violation = drc.errors[0]
  if (violation?.type !== "pcb_via_clearance_error") {
    throw new Error("Expected the different-net copper clearance violation")
  }
  expect(violation.actual_clearance).toBeCloseTo(0.2, 9)
  expect(
    drc.circuitJson.find((element) => element.type === "pcb_board"),
  ).toMatchObject({ min_pad_edge_to_pad_edge_clearance: 0.25 })
})
