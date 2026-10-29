import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("omitted and false feedback flags retain the same stages, HD parameters, explored work and route bytes", (): void => {
  const fixture = createDetailedFeedbackFixture()
  const pipelines = [undefined, false].map((flag) => {
    const pipeline = new Pipeline9({ layerCount: 2, minTraceWidth: 0.15,
      bounds: { minX: -12, maxX: 12, minY: -12, maxY: 12 }, obstacles: [], connections: [] },
      { effort: 1, cacheProvider: null, ...(flag === undefined ? {} : { experimentDetailedFeedback: flag }) })
    pipeline.portPointPathingSolver = fixture.initialPathingSolver
    pipeline.uniformPortDistributionSolver = fixture.initialDistributionSolver
    return pipeline
  })
  expect(pipelines[0]!.pipelineDef.map((step) => step.solverName)).toEqual(pipelines[1]!.pipelineDef.map((step) => step.solverName))
  const results = pipelines.map((pipeline) => {
    expect(pipeline.pipelineDef.some((step) => step.solverName === "detailedFeedbackSolver")).toBe(false)
    expect(pipeline.detailedFeedbackSolver).toBeUndefined()
    const hdStep = pipeline.pipelineDef.find((step) => step.solverName === "highDensityRouteSolver")!
    const [params] = hdStep.getConstructorParams(pipeline) as [Pipeline9HighDensitySolverParams]
    expect(Object.hasOwn(params, "detailedFeedbackWorkDebit")).toBe(false)
    const solver = new Pipeline9HighDensitySolver(params)
    expect(solver.MAX_ITERATIONS).toBe(100e6)
    solver.solve()
    expect(solver.solved).toBe(true)
    return { routes: JSON.stringify(solver.routes), stats: solver.stats, iterations: solver.iterations }
  })
  expect(results[0]).toEqual(results[1])
})
