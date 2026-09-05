import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("retains a preloaded trace's declared obstacle net without a pending connection", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "existing",
    connection_name: "already-routed",
    route: [
      { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.15 },
      { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.15 },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [],
    traces: [trace],
    obstacles: [-1, 1].map((x, i) => ({
      type: "rect",
      layers: ["top"],
      center: { x, y: 0 },
      width: 0.6,
      height: 0.6,
      connectedTo: [
        `pad${i}`,
        "existing",
        "already-routed",
        `pad${i}`,
        `port${i}`,
      ],
    })),
  }
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [],
    }).errors,
  ).toEqual([])
})
