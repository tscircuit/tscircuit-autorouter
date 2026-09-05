import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("preserves legacy pad fragments and still reports an endpoint outside copper", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: -0.3, layer: "top" },
          { x: 2, y: -0.3, layer: "top" },
        ],
      },
    ],
    obstacles: [0.3, 0, -0.3].map((y) => ({
      type: "rect",
      center: { x: 0, y },
      width: 0.6,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["pad-a", "signal", "pad-a", "port-a"],
    })),
  }
  srj.obstacles.push({
    type: "rect",
    center: { x: 2, y: -0.3 },
    width: 0.6,
    height: 0.6,
    layers: ["top"],
    connectedTo: ["pad-b", "signal", "pad-b", "port-b"],
  })
  srj.obstacles.push(structuredClone(srj.obstacles[0]))
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "routed",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: 0, y: -0.3, layer: "top", width: 0.15 },
      { route_type: "wire", x: 2, y: -0.3, layer: "top", width: 0.15 },
    ],
  }
  const check = (routed: SimplifiedPcbTrace) =>
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [routed],
    })
  const result = check(trace)
  expect(result.errors).toEqual([])
  expect(
    result.circuitJson.filter((e) => e.type === "pcb_smtpad"),
  ).toHaveLength(4)
  expect(srj.obstacles[0].circuitJsonMetadata).toBeUndefined()
  const broken = structuredClone(trace)
  Object.assign(broken.route[0], { x: -1, y: -1 })
  expect(
    check(broken).errors.some((e) =>
      e.message.includes("disconnected endpoint"),
    ),
  ).toBe(true)
})
