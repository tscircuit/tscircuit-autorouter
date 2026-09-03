import { expect, test } from "bun:test"
import { BasePipelineSolver } from "lib/solvers/BasePipelineSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"

class ProgressPipeline extends BasePipelineSolver {
  pipelineDef = ["preprocess", "route", "postprocess", "validate"]
  currentPipelineStepIndex = 0
}

test("pipeline progress includes partial stages and preserves terminal state", () => {
  const pipeline = new ProgressPipeline()
  pipeline.currentPipelineStepIndex = 1
  pipeline.activeSubSolver = new BaseSolver()
  pipeline.activeSubSolver.progress = 0.5
  pipeline.step()
  expect(pipeline.progress).toBe(0.375)

  // Changing search strategies can reduce a stage's own estimate.
  pipeline.activeSubSolver.progress = 0.1
  pipeline.step()
  expect(pipeline.progress).toBe(0.375)

  pipeline.activeSubSolver = null
  pipeline.currentPipelineStepIndex = 2
  pipeline.step()
  expect(pipeline.progress).toBe(0.5)

  // Stages without an estimate still contribute when they finish.
  pipeline.activeSubSolver = new BaseSolver()
  pipeline.step()
  expect(pipeline.progress).toBe(0.5)
  pipeline.activeSubSolver.progress = 2
  pipeline.step()
  expect(pipeline.progress).toBe(0.75)

  pipeline.failed = true
  expect(pipeline.computeProgress()).toBe(0.75)
  const emptyPipeline = new ProgressPipeline()
  emptyPipeline.pipelineDef = []
  expect(emptyPipeline.computeProgress()).toBe(0)
  emptyPipeline.solved = true
  expect(emptyPipeline.computeProgress()).toBe(1)
})
