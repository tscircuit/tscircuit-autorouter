import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("a routed endpoint on the wrong pad does not merge the requested nets", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
      { name: "other", pointsToConnect: [{ x: 0, y: 0, layer: "top" }] },
    ],
    obstacles: [-2, 0, 2].map((x) => ({
      type: "rect",
      layers: ["top"],
      center: { x, y: 0 },
      width: 0.5,
      height: 0.5,
      connectedTo: [x === 0 ? "other" : "signal"],
      circuitJsonMetadata: {
        pcb_smtpad_id: `pad${x}`,
        pcb_port_id: `port${x}`,
      },
    })),
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "bad-route",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const result = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [trace],
  })
  expect(
    result.errors.some((e) => e.message.includes("accidental contact")),
  ).toBe(true)
  const source = result.circuitJson.find(
    (e) => e.type === "source_trace" && e.source_trace_id === "signal",
  )
  expect(
    source?.type === "source_trace" &&
      source.connected_source_net_ids.includes("other"),
  ).toBe(false)
})
