import { expect, test } from "bun:test"
import { createGeometryFeedbackPlanningFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("a certified refinement that cannot route fails visibly without restoring the infeasible plan", (): void => {
  const { pipeline, feedback } = createGeometryFeedbackPlanningFixture({ upperCorridor: false })
  // The fixture has no alternative corridor. Cutting the original blocked
  // edge disconnects the graph; the primary solution cannot be restored.
  feedback.solve()
  expect(feedback.failed).toBeTrue()
  expect(feedback.solved).toBeFalse()
  expect(feedback.error).toContain("Certified geometry refinement failed")
  expect(feedback.pathingSolver).not.toBe(pipeline.portPointPathingSolver)
  expect(pipeline.geometryFeedbackStats.replans).toBe(1)
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
})
