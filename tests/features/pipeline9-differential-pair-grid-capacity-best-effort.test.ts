import { expect, test } from "bun:test"
import { Pipeline9DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-differential-pair-post-processing-solver"

test("Pipeline9 preserves upstream grid-capacity best-effort output", () => {
  const hdRoutes = [
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
  ]
  const solver = new Pipeline9DifferentialPairPostProcessingSolver({
    hdRoutes,
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance: 0.01 }],
    obstacles: [],
    bounds: { minX: -500, maxX: 500, minY: -500, maxY: 500 },
    layerCount: 2,
    obstacleMargin: 0.1,
  })

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.lengthMatchingSolver).toBeUndefined()
  expect(solver.postProcessingSolver).toBeDefined()
  expect(solver.getOutput().hdRoutes).toEqual(hdRoutes)
  expect(solver.getOutput().postProcessingErrors).toMatchObject([
    {
      reason: "grid-capacity-exhausted",
      returnedRouteSource: "input-hd-routes",
    },
  ])
})
