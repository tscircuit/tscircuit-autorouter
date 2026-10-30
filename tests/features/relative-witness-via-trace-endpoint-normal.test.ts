import { expect, test } from "bun:test"
import { getRelativeViaTraceTargets } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getRelativeViaTraceTargets"

test("endpoint projections give the same finite outward proposals for either wire orientation", () => {
  const input = { site: { x: 1.2, y: 0.15, diameter: 0.3, layers: ["top", "bottom"] }, start: { x: -1, y: 0 }, end: { x: 1, y: 0 }, wireWidth: 0.1, wireLayer: "bottom", minimumClearance: 0.1 }
  const targets = getRelativeViaTraceTargets(input)
  expect(targets.length).toBeGreaterThan(0)
  expect(Math.hypot(targets[0]!.x - input.end.x, targets[0]!.y - input.end.y) - 0.15 - 0.05).toBeCloseTo(0.101, 12)
  expect(getRelativeViaTraceTargets({ ...input, start: input.end, end: input.start })).toEqual(targets)
})
