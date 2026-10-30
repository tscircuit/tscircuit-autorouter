import { expect, test } from "bun:test"
import { relativeWitnessRepairFixture, proveRelativeFixture } from "./relativeWitnessRepairFixture"

test("same-owner original PTH outer footprints cannot be used as presumed barrel or pad contacts", () => {
  const input = relativeWitnessRepairFixture()
  input.originalSrj.obstacles.push({ type: "rect", center: { x: -2.15, y: -3 }, width: 0.2, height: 0.2, layers: ["top", "inner1", "inner2", "bottom"], connectedTo: ["D"], circuitJsonMetadata: { pcb_plated_hole_id: "unknown-drill" } })
  input.pointPairs = structuredClone(input.originalSrj)
  expect(proveRelativeFixture(input).status).toBe("UNKNOWN")
})
