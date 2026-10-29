import { expect, test } from "bun:test"
import { Pipeline9GeometryFeedbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9GeometryFeedbackSolver"
import { createGeometryFeedbackPlanningFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("proof-driven refinement cannot create another global search budget after exhaustion", (): void => {
  const { pipeline } = createGeometryFeedbackPlanningFixture()
  const primary = pipeline.portPointPathingSolver!
  primary.MAX_ITERATIONS = primary.iterations
  const step = pipeline.pipelineDef.find((entry) => entry.solverName === "geometryFeedbackSolver")!
  const params = step.getConstructorParams(pipeline) as ConstructorParameters<typeof Pipeline9GeometryFeedbackSolver>
  const feedback = new Pipeline9GeometryFeedbackSolver(...params)
  feedback.solve()
  expect(feedback.failed).toBeTrue()
  expect(feedback.solved).toBeFalse()
  expect(feedback.error).toContain("no remaining global planning budget")
  expect(feedback.pathingSolver).toBe(primary)
  expect(pipeline.geometryFeedbackStats.replans).toBe(0)
  expect(pipeline.geometryFeedbackStats.cuts).toBe(0)
  expect(pipeline.geometryFeedbackStats.constructorCalls).toBe(1)
})
