import { expect, test } from "bun:test"
import { Pipeline9DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-differential-pair-post-processing-solver"

test("Pipeline9 keeps maxUncoupledLength pairs on coupled post-processing", () => {
  const solver = new Pipeline9DifferentialPairPostProcessingSolver({
    hdRoutes: [
      {
        connectionName: "P",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "N",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 1, z: 0 },
          { x: 5, y: 1, z: 0 },
        ],
        vias: [],
      },
    ],
    differentialPairs: [
      {
        connectionNames: ["P", "N"],
        lengthTolerance: 0.05,
        maxUncoupledLength: 3,
      },
    ],
    obstacles: [],
    bounds: { minX: -1, maxX: 6, minY: -1, maxY: 2 },
    layerCount: 2,
    obstacleMargin: 0.1,
  })

  expect(solver.lengthMatchingSolver).toBeUndefined()
  expect(solver.postProcessingSolver).toBeDefined()
  expect(
    solver.postProcessingSolver?.getConstructorParams()[0].differentialPairs[0]
      ?.maxUncoupledLength,
  ).toBe(3)
})
