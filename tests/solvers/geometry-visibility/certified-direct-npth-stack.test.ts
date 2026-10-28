import { expect, test } from "bun:test"
import { getCertifiedDirectRoutingPlan } from "lib/testing/getCertifiedDirectRoutingPlan"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("a mechanical hole blocks the whole stack even when tagged with another plane and a matching owner", () => {
  const input = getCertifiedDirectTestInput()
  input.layerCount = 4
  input.obstacles = [{ type: "rect", isNonPlatedHole: true, center: { x: 0, y: 0 }, width: 0.2, height: 0.2,
    layers: ["bottom"], connectedTo: ["signal"] }]
  expect(getCertifiedDirectRoutingPlan(input).eligible).toBe(false)
  input.obstacles[0].isNonPlatedHole = false
  expect(getCertifiedDirectRoutingPlan(input).eligible).toBe(true)
})
