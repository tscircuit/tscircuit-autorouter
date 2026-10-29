import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9DetailedFeedbackSolver, type DetailedFeedbackParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("the actual Pipeline9 factory replaces both upstream witnesses and debits the following HD stage", (): void => {
  const fixture = createDetailedFeedbackFixture()
  const pipeline = new Pipeline9({ layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -12, maxX: 12, minY: -12, maxY: 12 }, obstacles: [], connections: [] },
    { effort: 1, cacheProvider: null, experimentDetailedFeedback: true })
  pipeline.portPointPathingSolver = fixture.initialPathingSolver
  pipeline.uniformPortDistributionSolver = fixture.initialDistributionSolver
  const feedbackIndex = pipeline.pipelineDef.findIndex((step) => step.solverName === "detailedFeedbackSolver")
  expect(feedbackIndex).toBe(pipeline.pipelineDef.findIndex((step) => step.solverName === "uniformPortDistributionSolver") + 1)
  const feedbackStep = pipeline.pipelineDef[feedbackIndex]!
  const [params] = feedbackStep.getConstructorParams(pipeline) as [DetailedFeedbackParams]
  params.probeStepsPerNode = 3
  const solver = new feedbackStep.solverClass(params) as Pipeline9DetailedFeedbackSolver
  pipeline.detailedFeedbackSolver = solver
  solver.solve()
  feedbackStep.onSolved!(pipeline)
  expect(solver.stats.changedAssignments).toBe(6)
  expect(pipeline.portPointPathingSolver).toBe(solver.selectedPathingSolver)
  expect(pipeline.uniformPortDistributionSolver).toBe(solver.selectedDistributionSolver)
  const hdStep = pipeline.pipelineDef[feedbackIndex + 1]!
  expect(hdStep.solverName).toBe("highDensityRouteSolver")
  const [hdParams] = hdStep.getConstructorParams(pipeline) as [Pipeline9HighDensitySolverParams]
  expect(hdParams.nodePortPoints).toEqual(solver.selectedDistributionSolver.getOutput())
  expect(hdParams.detailedFeedbackWorkDebit).toBe(solver.stats.chargedWork)
  expect(pipeline.highDensityNodePortPoints).toEqual(hdParams.nodePortPoints)
  expect(pipeline.highDensityNodePortPoints).not.toBe(hdParams.nodePortPoints)
  const finalHd = new Pipeline9HighDensitySolver(hdParams)
  expect(finalHd.MAX_ITERATIONS).toBe(100e6 - solver.stats.chargedWork)
  expect(pipeline.MAX_ITERATIONS).toBe(100e6)
  expect(solver.stats.selectedReplan).toBe(true)
  expect(pipeline.opts.experimentDetailedFeedback).toBe(true)
})
