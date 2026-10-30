import { expect, test } from "bun:test"
import { getRelativeViaTraceTargets } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getRelativeViaTraceTargets"
import { isCopperPointWithinRadius } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/relativeCopperSweepGeometry"

test("finite outward proposals clear a foreign segment at a 0.001 mm proposal margin while respecting the hard cap", () => {
  const input = { site: { x: 0, y: 0.27, diameter: 0.3, layers: ["top", "inner1", "inner2", "bottom"] }, start: { x: -1, y: 0 }, end: { x: 1, y: 0 }, wireWidth: 0.1, wireLayer: "bottom", minimumClearance: 0.1 }
  const bytes = JSON.stringify(input), targets = getRelativeViaTraceTargets(input)
  expect(targets.length).toBeGreaterThan(0)
  expect(targets[0]!.x).toBe(0)
  expect(targets[0]!.y - 0.15 - 0.05).toBeCloseTo(0.101, 12)
  for (const target of targets) expect(isCopperPointWithinRadius(input.site, target, 0.25)).toBe(true)
  expect(JSON.stringify(input)).toBe(bytes)
})
