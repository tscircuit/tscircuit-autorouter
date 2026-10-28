import { expect, test } from "bun:test"
import { witnessCatalog, witnessCharge, witnessRoute } from "./witnessCompatibilityTestUtils"

test("exact pair clauses include full through-via barrels on intermediate layers", () => {
  const a = witnessRoute("a", [{ x: -1, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }])
  const b = witnessRoute("b", [
    { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 1 },
  ])
  const through = witnessCatalog([a, b], { allowBlindAndBuriedVias: false })
  expect(through.conflict(through.add(0, a, witnessCharge), through.add(1, b, witnessCharge), witnessCharge)).toBe(true)
  const blind = witnessCatalog([a, b], { allowBlindAndBuriedVias: true })
  expect(blind.conflict(blind.add(0, a, witnessCharge), blind.add(1, b, witnessCharge), witnessCharge)).toBe(false)
})
