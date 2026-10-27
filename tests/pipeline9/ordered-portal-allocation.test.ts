import { expect, test } from "bun:test"
import { allocateOrderedPortalCoordinates } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"

test("ordered portal allocation jointly pools incompatible targets and enforces exact lane capacity", (): void => {
  const coordinates = allocateOrderedPortalCoordinates({ targets: [0.9, 0.1, 0.5], lower: 0.1, upper: 0.9, pitch: 0.2 })!
  for (const [index, expected] of [0.3, 0.5, 0.7].entries()) expect(coordinates[index]).toBeCloseTo(expected, 12)
  expect(allocateOrderedPortalCoordinates({ targets: [0, 1, 2], lower: 0, upper: 0.39, pitch: 0.2 })).toBeUndefined()
  expect(allocateOrderedPortalCoordinates({ targets: [-2, 8], lower: -0.5, upper: 0.5, pitch: 0.2 })).toEqual([-0.5, 0.5])
  const energy = coordinates.reduce((sum, value, index) => sum + (value - [0.9, 0.1, 0.5][index]!) ** 2, 0)
  // Independently enumerate feasible candidates rather than duplicating PAVA.
  for (let a = 0.1; a <= 0.5; a += 0.02) for (let b = a + 0.2; b <= 0.7; b += 0.02)
    for (let c = b + 0.2; c <= 0.9; c += 0.02) expect(energy).toBeLessThanOrEqual((a - 0.9) ** 2 + (b - 0.1) ** 2 + (c - 0.5) ** 2 + 1e-10)
})
