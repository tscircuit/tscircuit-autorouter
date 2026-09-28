import { expect, test } from "bun:test"
import { LengthMatchingPostProcessingSolver } from "../lib/solvers/length-matching-post-processing-solver"
import type { HighDensityRoute } from "../lib/types/high-density-types"

test("preserves matched pair when upstream optimization exceeds grid capacity", (): void => {
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "P",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "N",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 1, z: 0 },
        { x: 10, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const solver = new LengthMatchingPostProcessingSolver({
    hdRoutes,
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance: 0.01 }],
    buses: [],
    connections: [],
    obstacles: [],
    bounds: { minX: -500, maxX: 500, minY: -500, maxY: 500 },
    layerCount: 2,
    obstacleMargin: 0.1,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput().hdRoutes).toEqual(hdRoutes)
})
