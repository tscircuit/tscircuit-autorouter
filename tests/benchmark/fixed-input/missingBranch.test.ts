import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "../../../lib/types/srj-types"
import { scoreRouting } from "../../../scripts/benchmark/fixed-input/scoreRouting"
import { routingFixture } from "./routingFixture"

test("all branches of a multi-terminal net must physically connect", () => {
  const srj = routingFixture()
  srj.obstacles[1].layers = ["top"]
  srj.connections[0].pointsToConnect[1] = { x: 3, y: 0, layer: "top" }
  srj.obstacles.push({ obstacleId: "branch", type: "rect", center: { x: 0, y: 3 }, width: 0.6, height: 0.6, layers: ["top"], connectedTo: ["signal"] })
  srj.connections[0].pointsToConnect.push({ x: 0, y: 3, layer: "top" })
  const traces: SimplifiedPcbTrace[] = [{ type: "pcb_trace", pcb_trace_id: "main", connection_name: "signal", route: [{ route_type: "wire", x: -3, y: 0, width: 0.15, layer: "top" }, { route_type: "wire", x: 3, y: 0, width: 0.15, layer: "top" }] }]
  const partial = scoreRouting(srj, traces)
  expect(partial.connectedConnections).toBe(0)
  expect(partial.unconnectedConnectionNames).toEqual(["signal"])
  expect(partial.drcViolationCount).toBe(0)
  traces.push({ type: "pcb_trace", pcb_trace_id: "branch", connection_name: "signal", route: [{ route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" }, { route_type: "wire", x: 0, y: 3, width: 0.15, layer: "top" }] })
  expect(scoreRouting(srj, traces).valid).toBe(true)
})
