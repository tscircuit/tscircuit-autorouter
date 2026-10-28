import { expect, test } from "bun:test"
import { getCertifiedDirectRoutingPlan } from "lib/testing/getCertifiedDirectRoutingPlan"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("nearby foreign terminals cannot acquire electrical permission from rounded coordinates", () => {
  const input = getCertifiedDirectTestInput()
  input.connections[0].pointsToConnect[0].x = 0
  input.connections.push({ name: "foreign", pointsToConnect: [
    { x: 0, y: 0.004, layer: "top", pcb_port_id: "foreign_a" },
    { x: 0, y: 1, layer: "top", pcb_port_id: "foreign_b" },
  ] })
  expect(getConnectivityMapFromSimpleRouteJson(input).areIdsConnected("signal", "foreign")).toBe(true)
  const plan = getCertifiedDirectRoutingPlan(input)
  expect(plan.eligible).toBe(false)
  if (plan.eligible) throw new Error("Foreign conductors were incorrectly certified")
  expect(plan.reason).toBe("no-clear-direct-layer")
})
