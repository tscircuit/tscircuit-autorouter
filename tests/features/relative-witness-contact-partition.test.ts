import { expect, test } from "bun:test"
import { relativeWitnessRepairFixture, proveRelativeFixture } from "./relativeWitnessRepairFixture"

test("two local replacements preserve exterior copper interfaces despite a separate unknown demand", () => {
  const input = relativeWitnessRepairFixture(), bytes = JSON.stringify(input)
  const proof = proveRelativeFixture(input)
  expect(proof.status).toBe("PASS")
  expect(proof.bundleCount).toBe(2)
  expect(proof.boundaryCount).toBe(4)
  expect(proof.primitivePairs).toBeGreaterThan(0)
  expect(JSON.stringify(input)).toBe(bytes)
})
