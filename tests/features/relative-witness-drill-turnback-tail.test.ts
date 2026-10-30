import { expect, test } from "bun:test"
import { relativeWitnessRepairFixture, proveRelativeFixture } from "./relativeWitnessRepairFixture"

test("an exterior interface point cannot exempt a fixed tail returning through the moving drill", () => {
  const input = relativeWitnessRepairFixture()
  input.traces[0]!.route.splice(4, 0, { route_type: "wire", x: 0.05, y: 0.75, layer: "inner1", width: 0.1 })
  const proof = proveRelativeFixture(input)
  expect(proof.status).toBe("UNKNOWN")
  expect(proof.reason).toContain("moving via could alter fixed material")
})
