import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("omitted and false geometry feedback preserve the exact pipeline, global output and work", (): void => {
  const input = createGeometryFeedbackFixture().srj
  const omitted = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { cacheProvider: null })
  const disabled = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), {
    cacheProvider: null, experimentGeometryFeedback: false,
  })
  expect(omitted.pipelineDef.map((step) => step.solverName)).toEqual(disabled.pipelineDef.map((step) => step.solverName))
  expect(omitted.pipelineDef.some((step) => step.solverName === "geometryFeedbackSolver")).toBeFalse()
  omitted.solveUntilPhase("highDensityRouteSolver")
  disabled.solveUntilPhase("highDensityRouteSolver")
  expect(omitted.failed).toBeFalse()
  expect(disabled.failed).toBeFalse()
  expect(omitted.portPointPathingSolver!.getOutput()).toEqual(disabled.portPointPathingSolver!.getOutput())
  expect(omitted.uniformPortDistributionSolver!.getOutput()).toEqual(disabled.uniformPortDistributionSolver!.getOutput())
  expect(omitted.portPointPathingSolver!.iterations).toBe(disabled.portPointPathingSolver!.iterations)
  expect(omitted.portPointPathingSolver!.MAX_ITERATIONS).toBe(disabled.portPointPathingSolver!.MAX_ITERATIONS)
  expect(omitted.iterations).toBe(disabled.iterations)
  expect(omitted.geometryFeedbackStats).toEqual(disabled.geometryFeedbackStats)
  expect(omitted.geometryFeedbackStats.activated).toBeFalse()
})
