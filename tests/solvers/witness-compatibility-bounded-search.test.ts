import { expect, test } from "bun:test"
import { witnessCatalog, witnessCharge, witnessRoute } from "./witnessCompatibilityTestUtils"

test("bounded catalog failure is a search outcome and final rejection cannot starve witness generation", () => {
  const a = witnessRoute("a", [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }])
  const b = witnessRoute("b", [{ x: -1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }])
  const tiny = witnessCatalog([a, b], { maxSelectionVisits: 1 })
  tiny.add(0, a, witnessCharge, {})
  tiny.add(1, b, witnessCharge, {})
  expect(tiny.select(witnessCharge)).toBeNull()
  expect(tiny.stats.witnessCompatibilitySelectionCaps).toBe(1)
  const catalog = witnessCatalog([a, b], { maxWitnessesPerTask: 2 })
  catalog.add(0, a, witnessCharge, {})
  catalog.add(1, b, witnessCharge, {})
  const selected = catalog.select(witnessCharge)!
  expect(selected).not.toBeNull()
  catalog.rejectSelection(selected)
  expect(catalog.select(witnessCharge)).toBeNull()
  expect(catalog.stats.witnessCompatibilitySelections).toBe(1)
  const alternative = witnessRoute("a", [a.route[0]!, { x: 0, y: -1.2, z: 0 }, a.route.at(-1)!])
  catalog.add(0, alternative, witnessCharge)
  expect(catalog.select(witnessCharge)).not.toBeNull()
  expect(catalog.stats.witnessCompatibilitySelections).toBe(2)
  catalog.add(0, witnessRoute("a", [a.route[0]!, { x: 0, y: -1.3, z: 0 }, a.route.at(-1)!]), witnessCharge)
  expect(catalog.stats.witnessCatalogEvictions).toBe(1)
})
