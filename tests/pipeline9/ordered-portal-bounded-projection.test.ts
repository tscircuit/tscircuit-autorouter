import { expect, test } from "bun:test"
import { allocateOrderedPortalCoordinates } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"

test("variable-width bounded portal projection dominates independently enumerated feasible placements", (): void => {
  for (let trial = 0; trial < 20; trial++) {
    const targets = [0, 1, 2].map((index) => (((trial + 3) * (index + 7)) % 13 - 6) / 10)
    const lowerBounds = [-0.4, -0.2, 0]
    const upperBounds = [0, 0.3, 0.5]
    const separations = trial % 2 ? [0.1, 0.2] : [0.2, 0.1]
    const result = allocateOrderedPortalCoordinates({ targets, lower: -Infinity, upper: Infinity, lowerBounds, upperBounds, pitch: 0, separations })!
    expect(result).toBeDefined()
    const energy = result.reduce((sum, coordinate, index) => sum + (coordinate - targets[index]!) ** 2, 0)
    for (let index = 0; index < result.length; index++) {
      expect(result[index]!).toBeGreaterThanOrEqual(lowerBounds[index]! - 1e-10)
      expect(result[index]!).toBeLessThanOrEqual(upperBounds[index]! + 1e-10)
      if (index > 0) expect(result[index]! - result[index - 1]!).toBeGreaterThanOrEqual(separations[index - 1]! - 1e-10)
    }
    for (let ia = -4; ia <= 0; ia++) for (let ib = -2; ib <= 3; ib++) for (let ic = 0; ic <= 5; ic++) {
      const candidate = [ia / 10, ib / 10, ic / 10]
      if (candidate[1]! - candidate[0]! < separations[0]! - 1e-10 || candidate[2]! - candidate[1]! < separations[1]! - 1e-10) continue
      const candidateEnergy = candidate.reduce((sum, coordinate, index) => sum + (coordinate - targets[index]!) ** 2, 0)
      expect(energy).toBeLessThanOrEqual(candidateEnergy + 1e-10)
    }
  }
})
