import { expect, test } from "bun:test"
import { relativeWitnessRepairFixture, proveRelativeFixture } from "./relativeWitnessRepairFixture"

test("a rotated oval/PTH envelope includes the whole possible rectangular land projection", () => {
  const input = relativeWitnessRepairFixture()
  const obstacle = { type: "oval", center: { x: -2.15, y: -3.2 }, width: 0.2, height: 0.1, ccwRotationDegrees: 45, layers: ["top", "inner1", "inner2", "bottom"], connectedTo: ["D"], circuitJsonMetadata: { pcb_plated_hole_id: "rotated-unknown" } }
  input.originalSrj.obstacles.push(obstacle as unknown as typeof input.originalSrj.obstacles[number])
  input.pointPairs = structuredClone(input.originalSrj)
  expect(proveRelativeFixture(input).status).toBe("UNKNOWN")
})
