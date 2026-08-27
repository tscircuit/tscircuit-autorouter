import { expect, test } from "bun:test"
import { Pipeline9DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-differential-pair-post-processing-solver"

test("Pipeline9 preserves best-effort output when length matching has no solution", () => {
  const hdRoutes = [
    {
      connectionName: "P",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "N",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 2, z: 0 },
        { x: 5, y: 2, z: 0 },
      ],
      vias: [],
    },
  ]
  const solver = new Pipeline9DifferentialPairPostProcessingSolver({
    hdRoutes,
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance: 0.01 }],
    obstacles: [],
    bounds: { minX: 0, maxX: 5, minY: 0, maxY: 2 },
    layerCount: 2,
    obstacleMargin: 0.1,
  })

  solver.solve()

  expect(solver.lengthMatchingSolver?.failed).toBe(true)
  expect(solver.lengthMatchingSolver?.error).toContain(
    "no same-layer straight segment",
  )
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput().hdRoutes).toMatchObject(hdRoutes)
  expect(solver.getOutput().postProcessingErrors.length).toBeGreaterThan(0)
})
