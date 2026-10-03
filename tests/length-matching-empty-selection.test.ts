import { expect, test } from "bun:test"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("length matching bypasses boards without matching constraints", () => {
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.6,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    },
  ]
  const solver = new LengthMatchingPostProcessingSolver({
    hdRoutes,
    differentialPairs: [],
    buses: [],
    connections: [],
    obstacles: [],
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    layerCount: 2,
    obstacleMargin: 0.15,
  })

  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBe(0)
  expect(solver.stats).toEqual({ bypassed: true })
  expect(solver.getOutput().hdRoutes).toBe(hdRoutes)
})
