import { expect, test } from "bun:test"
import { getPipeline9OriginalOwnerCopperFeedback, mergePipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("matching native findings acquire strict identity once while every original native field remains intact", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  fixture.params.originalSrj.obstacles = []
  const evaluated = fixture.evaluate(fixture.params.newHdRoutes)
  expect(evaluated.native.errors.length).toBeGreaterThan(0)
  const feedback = getPipeline9OriginalOwnerCopperFeedback({ originalSrj: fixture.params.originalSrj,
    srjWithPointPairs: fixture.params.srjWithPointPairs, routedTraces: evaluated.traces, circuitJson: evaluated.native.circuitJson })
  expect(feedback.errors).toHaveLength(1)
  const original = structuredClone(evaluated.native.errors)
  const merged = mergePipeline9OriginalOwnerCopperFeedback(evaluated.native.errors as unknown as Record<string, unknown>[], feedback.errors)
  expect(merged.appendedCount).toBe(0)
  expect(merged.errors).toHaveLength(original.length)
  for (let i = 0; i < original.length; i++) {
    for (const [key, value] of Object.entries(original[i]!)) expect(merged.errors[i]![key]).toEqual(value)
  }
  expect(merged.errors.some((error) => typeof error.originalOwnerCopperFeedbackKey === "string")).toBe(true)
  expect(evaluated.native.errors).toEqual(original)
  expect(mergePipeline9OriginalOwnerCopperFeedback(merged.errors, feedback.errors).errors).toEqual(merged.errors)
})
