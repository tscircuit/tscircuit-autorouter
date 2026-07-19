import { expect, test } from "bun:test"
import { runForceDirectedImprovement } from "high-density-repair01/lib/HighDensityForceImproveSolver"

test("high-density force improvement stops after route positions converge", () => {
  const inputRoutes = [
    {
      connectionName: "stable-route",
      rootConnectionName: "stable-route",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]

  const result = runForceDirectedImprovement(
    { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    inputRoutes,
    100,
    { includeForceVectors: false },
  )

  expect(result.stepsCompleted).toBe(60)
  expect(result.routes).toEqual(inputRoutes)
})
