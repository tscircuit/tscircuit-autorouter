import { expect, test } from "bun:test"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("length matching bypasses boards without matching constraints", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
  }
  const solver = new LengthMatchingPostProcessingSolver({
    hdRoutes: [route],
    differentialPairs: [],
    buses: [],
    connections: [],
    obstacles: [],
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 2,
    obstacleMargin: 0.1,
  })

  expect(solver.solved).toBe(true)
  expect(solver.getOutput().hdRoutes).toEqual([route])
})
