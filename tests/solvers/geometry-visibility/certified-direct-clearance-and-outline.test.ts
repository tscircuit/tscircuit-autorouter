import { expect, test } from "bun:test"
import { getCertifiedDirectRoutingPlan } from "lib/testing/getCertifiedDirectRoutingPlan"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("manufactured width and concave board edges can reject a visually clear centerline", () => {
  const input = getCertifiedDirectTestInput()
  input.obstacles = [{ type: "rect", center: { x: 0, y: 0.4 }, width: 0.4, height: 0.2,
    layers: ["top"], connectedTo: [] }]
  expect(getCertifiedDirectRoutingPlan(input).eligible).toBe(true)
  input.connections[0].nominalTraceWidth = 0.5
  expect(getCertifiedDirectRoutingPlan(input).eligible).toBe(false)
  input.connections[0].nominalTraceWidth = 0.2
  input.obstacles = []
  input.outline = [{ x: -3, y: -2 }, { x: 3, y: -2 }, { x: 3, y: 2 }, { x: 0.2, y: 2 },
    { x: 0.2, y: -0.2 }, { x: -0.2, y: -0.2 }, { x: -0.2, y: 2 }, { x: -3, y: 2 }]
  expect(getCertifiedDirectRoutingPlan(input).eligible).toBe(false)
})
