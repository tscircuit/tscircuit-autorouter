import { expect, test } from "bun:test"
import { getEffortScale } from "../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("getEffortScale handles undefined and numeric values correctly", () => {
  // undefined should fallback to 1
  expect(getEffortScale(undefined)).toBe(1)
  // NaN should fallback to 1
  expect(getEffortScale(Number.NaN)).toBe(1)
  // Normal effort value
  expect(getEffortScale(2)).toBe(2)
  // Fractional effort value above minimum
  expect(getEffortScale(0.5)).toBe(0.5)
  // Very small effort should be floored at 0.01 (1e-2)
  expect(getEffortScale(0.001)).toBe(0.01)
})
