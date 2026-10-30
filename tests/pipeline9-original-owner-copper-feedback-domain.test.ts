import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("valid unowned original copper records an inactive domain and preserves native work instead of claiming strict coverage", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  fixture.params.originalSrj.obstacles.push({ type: "rect", center: { x: 1.6, y: 1.6 }, width: 0.1, height: 0.1,
    layers: ["top"], connectedTo: [], circuitJsonMetadata: { pcb_smtpad_id: "unowned_original_pad" } })
  const disabled = new Pipeline9JointDrcRepairSolver(fixture.params)
  const enabled = new Pipeline9JointDrcRepairSolver({ ...fixture.params, experimentOriginalOwnerCopperFeedback: true })
  disabled.solve(); enabled.solve()
  expect(enabled.solved).toBe(disabled.solved)
  expect(enabled.failed).toBe(disabled.failed)
  expect(enabled.getOutput()).toEqual(disabled.getOutput())
  expect(enabled.iterations).toBe(disabled.iterations)
  expect(enabled.MAX_ITERATIONS).toBe(disabled.MAX_ITERATIONS)
  const cold = enabled.stats.originalOwnerCopperFeedback as Record<string, unknown>
  expect(cold.status).toBe("NOT_APPLICABLE")
  expect(cold.originalOwnershipCoverage).toBe("UNKNOWN")
  expect(cold.appendedIssueCount).toBe(0)
  expect(cold.referenceEvaluations).toBe(2)
  expect(Object.keys(cold)).toHaveLength(15)
  expect(Object.values(cold).every((value) => value === null || ["string", "number", "boolean"].includes(typeof value))).toBe(true)
  expect(disabled.stats.originalOwnerCopperFeedback).toBeUndefined()
})
