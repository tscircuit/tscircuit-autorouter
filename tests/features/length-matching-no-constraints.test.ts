import { expect, test } from "bun:test"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("length matching is a no-op without constrained nets", () => {
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.6,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const solver = new LengthMatchingPostProcessingSolver({
    hdRoutes,
    differentialPairs: [],
    buses: [],
    connections: [],
    obstacles: [],
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    layerCount: 2,
    obstacleMargin: 0.15,
  })

  expect(solver.solved).toBeTrue()
  expect(solver.getOutput().hdRoutes).toBe(hdRoutes)
})
