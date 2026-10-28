import { expect, test } from "bun:test"
import { getCertifiedDirectRoutingPlan } from "lib/testing/getCertifiedDirectRoutingPlan"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("the certificate checks actual circle envelopes and rotated foreign pads", () => {
  const input = getCertifiedDirectTestInput()
  input.obstacles = [{ type: "rect", center: { x: 0, y: 0.4 }, width: 2, height: 0.1,
    layers: ["top"], connectedTo: [], ccwRotationDegrees: 0 }]
  expect(getCertifiedDirectRoutingPlan(input).eligible).toBe(true)
  input.obstacles[0].ccwRotationDegrees = 90
  expect(getCertifiedDirectRoutingPlan(input).eligible).toBe(false)
  input.obstacles[0] = { type: "rect", shape: "circle", center: { x: 0, y: 0.4 }, width: 0.2, height: 1,
    layers: ["top"], connectedTo: [] }
  expect(getCertifiedDirectRoutingPlan(input).eligible).toBe(false)
})
