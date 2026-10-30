import { expect, test } from "bun:test"
import { isWireDiskInsideSmtLand } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/relativeCopperSweepGeometry"
import { relativeWitnessRepairFixture, proveRelativeFixture } from "./relativeWitnessRepairFixture"

test("an oval bounding-box corner never establishes a solid SMT copper interface", () => {
  expect(isWireDiskInsideSmtLand({ x: 0.8, y: 0.8 }, 0.05, { type: "oval", center: { x: 0, y: 0 }, width: 2, height: 2 })).toBe(false)
  const input = relativeWitnessRepairFixture()
  Object.assign(input.originalSrj.obstacles[1]!, { type: "oval" })
  input.pointPairs = structuredClone(input.originalSrj)
  expect(proveRelativeFixture(input).status).toBe("UNKNOWN")
})
