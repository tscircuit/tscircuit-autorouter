import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { DetailedFeedbackParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("sync and host-orchestrated worker execution select the same revised master and final synthetic HD routes", async (): Promise<void> => {
  const pipelines = [false, true].map(() => {
    const fixture = createDetailedFeedbackFixture()
    const pipeline = new Pipeline9({ layerCount: 2, minTraceWidth: 0.15,
      bounds: { minX: -12, maxX: 12, minY: -12, maxY: 12 }, obstacles: [], connections: [] },
      { effort: 1, cacheProvider: null, experimentDetailedFeedback: true })
    pipeline.portPointPathingSolver = fixture.initialPathingSolver
    pipeline.uniformPortDistributionSolver = fixture.initialDistributionSolver
    const index = pipeline.pipelineDef.findIndex((step) => step.solverName === "detailedFeedbackSolver")
    // Exercise only the optional planning and HD stages on this synthetic mesh.
    // This deliberately makes no claim about a completed/validated PCB.
    pipeline.pipelineDef = pipeline.pipelineDef.slice(index, index + 2)
    const step = pipeline.pipelineDef[0]!
    const getParams = step.getConstructorParams
    step.getConstructorParams = (cms) => {
      const params = getParams(cms) as [DetailedFeedbackParams]
      params[0].probeStepsPerNode = 3
      return params
    }
    return pipeline
  })
  pipelines[0]!.solve()
  const runtime = createPipeline9TestRuntime(1)
  try {
    await pipelines[1]!.solveAsync(runtime)
  } finally {
    await runtime.dispose()
  }
  for (const pipeline of pipelines) {
    expect(pipeline.failed).toBe(false)
    expect(pipeline.detailedFeedbackSolver?.stats.replansCompleted).toBe(1)
    expect(pipeline.detailedFeedbackSolver?.stats.changedAssignments).toBe(6)
    expect(pipeline.portPointPathingSolver).toBe(pipeline.detailedFeedbackSolver?.selectedPathingSolver)
    expect(pipeline.uniformPortDistributionSolver).toBe(pipeline.detailedFeedbackSolver?.selectedDistributionSolver)
    expect(pipeline.highDensityRouteSolver?.MAX_ITERATIONS).toBe(100e6 - pipeline.detailedFeedbackSolver!.stats.chargedWork)
  }
  expect(pipelines[1]!.highDensityRouteSolver!.benchmarkDiagnosticCounters.priorityWorkerNodesAccepted).toBeGreaterThan(0)
  expect(pipelines[1]!.highDensityRouteSolver!.routes).toEqual(pipelines[0]!.highDensityRouteSolver!.routes)
  expect(pipelines[1]!.highDensityRouteSolver!.stats).toEqual(pipelines[0]!.highDensityRouteSolver!.stats)
  expect(pipelines[1]!.highDensityRouteSolver!.iterations).toBe(pipelines[0]!.highDensityRouteSolver!.iterations)
  expect(pipelines[1]!.iterations).toBe(pipelines[0]!.iterations)
})
