import { expect, test } from "bun:test"
import { witnessCatalog, witnessCharge, witnessRoute } from "./witnessCompatibilityTestUtils"

test("electrical ownership never hides too-close distinct drill sites", () => {
  const a = witnessRoute("a", [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }])
  const b = witnessRoute("b", [{ x: 0.2, y: 0, z: 0 }, { x: 0.2, y: 0, z: 1 }])
  const sameOwner = witnessCatalog([a, b], { owners: ["shared-net", "shared-net"] })
  expect(sameOwner.conflict(sameOwner.add(0, a, witnessCharge), sameOwner.add(1, b, witnessCharge), witnessCharge)).toBe(true)
  const coincident = witnessRoute("b", [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }])
  const sharedSite = witnessCatalog([a, coincident], { owners: ["shared-net", "shared-net"] })
  expect(sharedSite.conflict(sharedSite.add(0, a, witnessCharge), sharedSite.add(1, coincident, witnessCharge), witnessCharge)).toBe(false)
})
