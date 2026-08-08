import { expect, test } from "bun:test"
import { DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/differential-pair-post-processing-solver"

test("returns routes when length-only matching has no meander candidate", () => {
  const hdRoutes = [
    {
      connectionName: "P",
      traceThickness: 0.2,
      viaDiameter: 0.5,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0, zLayers: [0, 1] }],
    },
    {
      connectionName: "N",
      traceThickness: 0.2,
      viaDiameter: 0.5,
      route: [
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
      ],
      vias: [],
    },
  ]
  const solver = new DifferentialPairPostProcessingSolver({
    hdRoutes,
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance: 0.01 }],
    obstacles: [],
    bounds: { minX: -1, maxX: 11, minY: -1, maxY: 3 },
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual({ hdRoutes })
})
