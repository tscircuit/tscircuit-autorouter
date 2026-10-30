import { expect, test } from "bun:test"
import { relativeWitnessRepairFixture, proveRelativeFixture } from "./relativeWitnessRepairFixture"

test("a constant boundary disk is not inferred across variable-width fanout or tail material", () => {
  const input = relativeWitnessRepairFixture()
  Object.assign(input.traces[0]!.route[4]!, { width: 0.2 })
  expect(proveRelativeFixture(input).status).toBe("UNKNOWN")
})
