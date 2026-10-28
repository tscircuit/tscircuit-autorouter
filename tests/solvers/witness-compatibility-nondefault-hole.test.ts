import { expect, test } from "bun:test"
import { witnessCatalog, witnessCharge, witnessRoute } from "./witnessCompatibilityTestUtils"

test("non-default physical drill dimensions determine compatibility rather than annulus or default drill size", () => {
  const a = witnessRoute("a", [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }])
  const b = witnessRoute("b", [{ x: 0.44, y: 0, z: 0 }, { x: 0.44, y: 0, z: 1 }])
  const configured = witnessCatalog([a, b], { owners: ["shared", "shared"], viaHoleDiameter: 0.25, minimumHoleGap: 0.22 })
  const defaults = witnessCatalog([a, b], { owners: ["shared", "shared"] })
  expect(configured.conflict(configured.add(0, a, witnessCharge), configured.add(1, b, witnessCharge), witnessCharge)).toBe(true)
  expect(defaults.conflict(defaults.add(0, a, witnessCharge), defaults.add(1, b, witnessCharge), witnessCharge)).toBe(false)
})
