import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 publication rejects worse inherited copper without leaking repaired sections", (): void => {
  const { srj, originalSrj, trace, solver } =
    createPipeline9InheritedPadClearanceFixture()
  const exactRepairSolver = solver.exactRepairSolver
  if (!exactRepairSolver) {
    throw new Error("Expected inherited copper to enter exact repair")
  }
  const originalPreloadedTraces =
    solver.getConstructorParams()[0].updatedPreloadedTraces
  const originalTraceRoute = trace.route
  const initialRoutes = structuredClone(exactRepairSolver.params.hdRoutes)
  expect(initialRoutes).toHaveLength(1)
  const worseningCandidate = structuredClone(initialRoutes)
  for (const point of worseningCandidate[0]!.route.slice(1, -1)) {
    point.y = -0.32
  }

  // Controlled publication-state contract, not a native optimizer replay:
  // submit a same-pair 0.04 -> 0.02 mm clearance regression at the real gate.
  solver["publishValidatedOutput"](worseningCandidate)

  expect(solver.stats.jointOutputValidationAttempted).toBeTrue()
  expect(solver.stats.jointOutputRejectedForDrcRegression).toBeTrue()
  expect(solver.stats.jointOutputAccepted).toBeFalse()
  expect(solver.stats.jointOutputCandidateDrcIssueCount).toBe(1)
  expect(solver.stats.publishedJointDrcIssueCount).toBe(1)
  expect(solver.getOutput()).toEqual([])
  expect(solver.getMutatedPreloadedTraces()).toEqual([])
  expect(solver.getUpdatedPreloadedTraces()).toBe(originalPreloadedTraces)
  expect(solver.getUpdatedPreloadedTraces()[0]).toBe(trace)
  expect(solver.getUpdatedPreloadedTraces()[0]?.route).toBe(originalTraceRoute)
  expect(srj).toEqual(originalSrj)
  const retainedDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: solver.getMutatedPreloadedTraces(),
  })
  expect(retainedDrc.errors).toHaveLength(1)
  const retainedError = retainedDrc.errors[0]!
  if (retainedError.type !== "pcb_pad_trace_clearance_error") {
    throw new Error("Expected the original inherited pad-clearance error")
  }
  expect(retainedError.actual_clearance).toBeCloseTo(0.04)

  // Positive control: identical terminals and section ownership, but enough
  // interior clearance. The gate must not reject every preloaded proposal.
  const cleanCandidate = structuredClone(initialRoutes)
  for (const point of cleanCandidate[0]!.route.slice(1, -1)) {
    point.y = -0.5
  }
  solver["publishValidatedOutput"](cleanCandidate)

  expect(solver.stats.jointOutputRejectedForDrcRegression).toBeFalse()
  expect(solver.stats.jointOutputAccepted).toBeTrue()
  expect(solver.stats.jointOutputCandidateDrcIssueCount).toBe(0)
  expect(solver.stats.publishedJointDrcIssueCount).toBe(0)
  expect(solver.getOutput()).toEqual([])
  const published = solver.getMutatedPreloadedTraces()
  expect(published).toHaveLength(1)
  expect(published[0]?.__replaces_pcb_trace_id).toBe(trace.pcb_trace_id)
  expect(published[0]?.route[0]).toEqual(originalTraceRoute[0])
  expect(published[0]?.route.at(-1)).toEqual(originalTraceRoute.at(-1))
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: published,
    }).errors,
  ).toHaveLength(0)
  expect(srj).toEqual(originalSrj)
})
