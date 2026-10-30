import { expect, test } from "bun:test"
import { areCopperSweepsSeparated, isCopperPointWithinRadius } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/relativeCopperSweepGeometry"

test("closed swept copper separation and movement caps use exact squared binary64 comparisons", () => {
  const line = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], radius: 0.1 }
  expect(areCopperSweepsSeparated(line, { points: [{ x: 0, y: 0.5 }], radius: 0.1 })).toBe(true)
  expect(areCopperSweepsSeparated(line, { points: [{ x: 0.5, y: 0.5 }], radius: 0 })).toBe(false)
  expect(areCopperSweepsSeparated({ points: [{ x: 0, y: 0 }], radius: 0.125 }, { points: [{ x: 0.25, y: 0 }], radius: 0.125 })).toBe(false)
  expect(areCopperSweepsSeparated({ points: [{ x: 0, y: 0 }], radius: 0.125 }, { points: [{ x: 0.25000000000000006, y: 0 }], radius: 0.125 })).toBe(true)
  expect(isCopperPointWithinRadius({ x: 0, y: 0 }, { x: 0.02, y: 0 }, 0.02)).toBe(true)
  expect(isCopperPointWithinRadius({ x: 0, y: 0 }, { x: 0.020000000000000004, y: 0 }, 0.02)).toBe(false)
  expect(areCopperSweepsSeparated({ box: { center: { x: 1, y: 1 }, halfWidth: [0.1, 0.2], halfHeight: [0.1] }, radius: 0 }, { points: [{ x: 1.2999999999999998, y: 1 }], radius: 0 })).toBe(false)
})
