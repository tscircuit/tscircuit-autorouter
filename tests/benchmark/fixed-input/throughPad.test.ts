import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "../../../lib/types/srj-types"
import { createFreeroutingDsn } from "../../../scripts/benchmark/fixed-input/freeroutingAdapter"
import { scoreRouting } from "../../../scripts/benchmark/fixed-input/scoreRouting"
import { routingFixture } from "./routingFixture"

test("a physical through pad connects layers but a surface pad does not", () => {
  const srj = routingFixture()
  srj.obstacles.push({
    obstacleId: "through",
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top", "bottom"],
    connectedTo: ["signal"],
  })
  srj.connections[0].pointsToConnect.push({
    x: 0,
    y: 0,
    layers: ["top", "bottom"],
  })
  expect(createFreeroutingDsn(srj)).toContain(
    '(padstack "padstack_2" (shape (rect F.Cu -500 -500 500 500)) (shape (rect B.Cu -500 -500 500 500))',
  )
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "top",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: -3, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom",
      connection_name: "signal",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "bottom" },
        { route_type: "wire", x: 3, y: 0, width: 0.15, layer: "bottom" },
      ],
    },
  ]
  expect(scoreRouting(srj, traces)).toMatchObject({ valid: true, viaCount: 0 })
  srj.obstacles[2].layers = ["top"]
  srj.connections[0].pointsToConnect[2] = { x: 0, y: 0, layer: "top" }
  expect(scoreRouting(srj, traces).connectedConnections).toBe(0)
})
