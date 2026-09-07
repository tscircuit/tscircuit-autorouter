import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "../../../lib/types/srj-types"
import { scoreRouting } from "../../../scripts/benchmark/fixed-input/scoreRouting"
import { routingFixture } from "./routingFixture"

test("the common scorer detects foreign copper, edge clearance and same-net via-in-pad", () => {
  const srj = routingFixture()
  srj.obstacles.push({
    obstacleId: "keepout",
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: [],
  })
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "crossing",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -3, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 4.9, y: 0, width: 0.15, layer: "top" },
      ],
    },
  ]
  const crossing = scoreRouting(srj, traces)
  expect(
    crossing.violations.some(
      (violation) =>
        violation.type === "copper_clearance" && violation.second === "keepout",
    ),
  ).toBe(true)
  expect(
    crossing.violations.some(
      (violation) => violation.type === "board_edge_clearance",
    ),
  ).toBe(true)
  traces[0].route = [
    {
      route_type: "via",
      x: -3,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.6,
      via_hole_diameter: 0.3,
    },
  ]
  expect(
    scoreRouting(srj, traces).violations.some(
      (violation) => violation.type === "via_in_pad",
    ),
  ).toBe(true)
  traces[0].route = [
    { route_type: "wire", x: -2, y: 0.725, width: 0.15, layer: "top" },
    { route_type: "wire", x: 2, y: 0.725, width: 0.15, layer: "top" },
  ]
  expect(scoreRouting(srj, traces).drcViolationCount).toBe(0)
  for (const point of traces[0].route) {
    if (point.route_type !== "wire") throw new Error("Expected wire fixture")
    point.y -= 0.001
  }
  expect(scoreRouting(srj, traces).drcViolationCount).toBeGreaterThan(0)
})
