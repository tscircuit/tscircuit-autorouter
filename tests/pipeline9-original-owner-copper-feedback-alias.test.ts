import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getPipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("strict declared owners turn a wrong-layer source alias false zero into an actionable full-span via target", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const before = structuredClone(fixture.params.newHdRoutes)
  const initial = fixture.evaluate(before)
  expect(initial.native.errors).toEqual([])
  const feedback = getPipeline9OriginalOwnerCopperFeedback({ originalSrj: fixture.params.originalSrj,
    srjWithPointPairs: fixture.params.srjWithPointPairs, routedTraces: initial.traces, circuitJson: initial.native.circuitJson })
  expect(feedback.status).toBe("SUPPORTED")
  expect(feedback.errors).toHaveLength(1)
  expect(feedback.errors[0]).toMatchObject({ type: "pcb_via_trace_clearance_error", minimum_clearance: 0.1 })
  expect(feedback.errors[0]!.actual_clearance).toBeCloseTo(0.06151, 10)
  expect(feedback.errors[0]!.pcb_trace_ids).toHaveLength(2)
  expect(feedback.errors[0]!.pcb_via_ids).toHaveLength(1)
  const solver = new Pipeline9JointDrcRepairSolver({ ...fixture.params, experimentOriginalOwnerCopperFeedback: true })
  expect(solver.solved).toBe(false)
  expect(solver.stats.initialJointDrcIssueCount).toBe(1)
  expect(solver.stats.originalOwnerCopperFeedback).toMatchObject({ status: "SUPPORTED", initialIssueCount: 1, selectedCheckCount: 2 })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const final = fixture.evaluate(solver.getOutput())
  expect(final.native.errors).toEqual([])
  const after = getPipeline9OriginalOwnerCopperFeedback({ originalSrj: fixture.params.originalSrj,
    srjWithPointPairs: fixture.params.srjWithPointPairs, routedTraces: final.traces, circuitJson: final.native.circuitJson })
  expect(after.status).toBe("SUPPORTED")
  expect(after.errors).toEqual([])
  expect(fixture.params.newHdRoutes).toEqual(before)
})
