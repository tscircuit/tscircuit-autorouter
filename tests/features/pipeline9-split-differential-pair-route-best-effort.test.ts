import { expect, test } from "bun:test"
import { Pipeline9DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-differential-pair-post-processing-solver"

test("Pipeline9 keeps split differential-pair routes on best-effort post-processing", () => {
  const pair = {
    connectionNames: ["P", "N"] as [string, string],
    lengthTolerance: 0.01,
  }
  const solver = new Pipeline9DifferentialPairPostProcessingSolver({
    hdRoutes: [
      {
        connectionName: "P",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "P",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 2, y: 0, z: 0 },
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
    differentialPairs: [pair],
    obstacles: [],
    bounds: { minX: -1, maxX: 6, minY: -1, maxY: 2 },
    layerCount: 2,
    obstacleMargin: 0.1,
  })

  expect(solver.lengthMatchingSolver).toBeUndefined()
  expect(
    solver.postProcessingSolver?.getConstructorParams()[0].differentialPairs,
  ).toEqual([pair])
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput().hdRoutes).toHaveLength(3)
})
