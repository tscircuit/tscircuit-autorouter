import { expect, test } from "bun:test"
import { Pipeline9HighDensityBatchSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("the production worker batch enters the same local contact policy", (): void => {
  const { node } = createPolylineContactFixture()
  const solver = new Pipeline9HighDensityBatchSolver({
    nodePortPoints: [node], fixedHdRoutes: [], connectivityNetMap: {},
    traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1,
    obstacles: [], layerCount: 2, effort: 1, maxIterations: 100_000,
  })
  solver.solve()
  const output = solver.getOutput()[0]!
  expect(output.solved).toBe(true)
  expect(output.routes).toHaveLength(2)
  expect(output.benchmarkDiagnosticCounters.contactInstances).toBeGreaterThan(0)
})
