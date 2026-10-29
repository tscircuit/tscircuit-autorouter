import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { Pipeline9DetailedFeedbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9HighDensityBatchSolver, type Pipeline9HighDensityBatchInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("the revised assignments and debited HD budget reach actual asynchronous batch solvers", async (): Promise<void> => {
  const params = createDetailedFeedbackFixture()
  params.probeStepsPerNode = 3
  const feedback = new Pipeline9DetailedFeedbackSolver(params)
  feedback.solve()
  const hdParams = { ...params.highDensityParams,
    nodePortPoints: feedback.selectedDistributionSolver.getOutput(),
    detailedFeedbackWorkDebit: feedback.stats.chargedWork }
  const baseline = new Pipeline9HighDensitySolver(hdParams)
  baseline.solve()
  const inputs: Pipeline9HighDensityBatchInput[] = []
  const runtime = { executeAsync: async (_Solver: unknown, input: Pipeline9HighDensityBatchInput) => {
    inputs.push(structuredClone(input))
    const batch = new Pipeline9HighDensityBatchSolver(input)
    batch.solve()
    return batch.getOutput()
  } } as SolverRuntimeExecutor
  const solver = new Pipeline9HighDensitySolver(hdParams)
  await solver.solveAsync(runtime)
  expect(inputs.length).toBeGreaterThan(0)
  for (const input of inputs) {
    expect(input.detailedFeedbackWorkDebit).toBe(feedback.stats.chargedWork)
    expect(input.maxIterations).toBe(100e6 - feedback.stats.chargedWork)
  }
  expect(inputs.flatMap((input) => input.nodePortPoints).sort((a, b) => a.capacityMeshNodeId.localeCompare(b.capacityMeshNodeId))).toEqual(
    [...hdParams.nodePortPoints].sort((a, b) => a.capacityMeshNodeId.localeCompare(b.capacityMeshNodeId)))
  expect(solver.routes).toEqual(baseline.routes)
  expect(solver.stats).toEqual(baseline.stats)
  expect(solver.iterations).toBe(baseline.iterations)
  expect(solver.solved).toBe(baseline.solved)
  expect(solver.failed).toBe(baseline.failed)
  expect(solver.error).toBe(baseline.error)
})
