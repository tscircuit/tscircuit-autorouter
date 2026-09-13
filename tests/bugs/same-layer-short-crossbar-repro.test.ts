import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { guaranteeNoSameLayerShorts } from "lib/utils/guaranteeNoSameLayerShorts"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  bounds: { minX: -1, maxX: 11, minY: -1, maxY: 21 },
  obstacles: [],
  connections: [
    {
      name: "netA",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 10, y: 10, layer: "top" },
      ],
    },
    {
      name: "netB",
      pointsToConnect: [
        { x: 0, y: 10, layer: "top" },
        { x: 10, y: 0, layer: "top" },
      ],
    },
  ],
}

const crossingTraces: SimplifiedPcbTraces = [
  {
    type: "pcb_trace",
    pcb_trace_id: "A",
    connection_name: "netA",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 10, y: 10, width: 0.15, layer: "top" },
    ],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "B",
    connection_name: "netB",
    route: [
      { route_type: "wire", x: 0, y: 10, width: 0.15, layer: "top" },
      { route_type: "wire", x: 10, y: 0, width: 0.15, layer: "top" },
    ],
  },
]

const overlapErrors = (traces: SimplifiedPcbTraces) =>
  getDrcErrors(
    convertToCircuitJson(srj, traces, { minTraceWidth: srj.minTraceWidth }),
  ).locationAwareErrors.filter((e) => e.message.includes("overlaps with trace"))

// #1507: same-layer different-net crossings are real shorts in the routed
// output. Pipeline 7 now throws on the original dense crossbar fixture
// (CrossingViaReductionSolver), so this asserts the safety net itself: DRC
// overlap errors go from >0 to 0 after guaranteeNoSameLayerShorts, and the
// public Pipeline7 output path still calls that helper.
test("guaranteeNoSameLayerShorts removes DRC overlap shorts from routed traces", () => {
  expect(overlapErrors(crossingTraces).length).toBeGreaterThan(0)
  const fixed = guaranteeNoSameLayerShorts(crossingTraces, 0)
  expect(overlapErrors(fixed).length).toBe(0)
})
