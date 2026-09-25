import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getTraceToHoleClearanceError } from "lib/utils/getTraceToHoleClearanceError"
import fixture from "./fixtures/hole-clearance/npth.srj.json"

test("hole validation measures copper edges on occupied layers including wire-to-via segments", (): void => {
  const srj = structuredClone(fixture) as SimpleRouteJson
  srj.minTraceToHoleClearance = 0.2
  const hole = srj.obstacles[2]!
  hole.isHole = true
  hole.shape = "circle"
  hole.layers = ["top"]
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -2, y: 1.3, width: 0.2, layer: "top" },
        {
          route_type: "via",
          x: 2,
          y: 1.3,
          from_layer: "top",
          to_layer: "bottom",
        },
      ],
    },
  ]
  expect(getTraceToHoleClearanceError(srj, traces)).toBeNull()
  for (const point of traces[0]!.route) {
    if (point.route_type !== "wire" && point.route_type !== "via") {
      throw new Error("Expected wire or via in test fixture")
    }
    point.y = 1.299
  }
  expect(getTraceToHoleClearanceError(srj, traces)).toContain("0.199000 mm")
  hole.layers = ["bottom"]
  expect(getTraceToHoleClearanceError(srj, traces)).toBeNull()
  hole.layers = ["top", "bottom"]
  const wire = traces[0]!.route[0]!
  if (wire.route_type !== "wire")
    throw new Error("Expected wire in test fixture")
  wire.width = 0.6
  expect(getTraceToHoleClearanceError(srj, traces)).toContain("-0.001000 mm")
  hole.isHole = false
  expect(getTraceToHoleClearanceError(srj, traces)).toBeNull()
})
