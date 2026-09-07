import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { Pipeline7AdaptiveDrcBranchPortfolioSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/Pipeline7AdaptiveDrcBranchPortfolioSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 inherited repair uses one fixed native pass without changing Joint policy", (): void => {
  const { srj, originalSrj, trace, solver } =
    createPipeline9InheritedPadClearanceFixture()
  const native = solver.exactRepairSolver
  if (!(native instanceof GlobalDrcForceImproveSolver)) {
    throw new Error("Expected one native inherited-copper repair pass")
  }
  expect(native).not.toBeInstanceOf(Pipeline7AdaptiveDrcBranchPortfolioSolver)
  expect(native.configuredMaxIterations).toBe(32)
  expect(native.MAX_ITERATIONS).toBe(32)
  expect(native.enableBroadFallback).toBeFalse()
  expect(native.enableLargeBoardBroadFallback).toBeFalse()
  expect(native.enablePostSolveClearanceRelaxation).toBeFalse()
  expect(native.enableTargetedErrorSweep).toBeTrue()
  expect(native.enableTraceViaOwnerTargeting).toBeTrue()
  expect(native.enableSafeTraceLayerMoves).toBeTrue()
  expect(native.enableViaInPadLayerMoves).toBeFalse()

  // Make this same defect new relative to a clean baseline so the original
  // Joint constructor really enters exact repair, rather than early-returning.
  const cleanBaseline = structuredClone(srj)
  for (const point of cleanBaseline.traces![0]!.route.slice(1, -1)) {
    if (point.route_type === "wire") point.y = -0.6
  }
  const originalJoint = new Pipeline9JointDrcRepairSolver({
    ...solver.getConstructorParams()[0],
    originalSrj: cleanBaseline,
    updatedPreloadedTraces: [
      { ...trace, __replaces_pcb_trace_id: trace.pcb_trace_id },
    ],
    mutatedPreloadedTraceIds: new Set([trace.pcb_trace_id]),
  })
  expect(originalJoint.stats.baselineJointDrcIssueCount).toBe(0)
  expect(originalJoint.stats.initialJointDrcIssueCount).toBe(1)
  expect(originalJoint.exactRepairSolver).toBeInstanceOf(
    Pipeline7AdaptiveDrcBranchPortfolioSolver,
  )

  while (!solver.solved && !solver.failed) {
    expect(solver.activeSubSolver).toBe(native)
    expect(native.activeSubSolver).toBeUndefined()
    solver.step()
    expect(native.MAX_ITERATIONS).toBe(32)
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.exactRepairSolver).toBe(native)
  expect(solver.activeSubSolver).toBeNull()
  expect(native.activeSubSolver).toBeUndefined()
  expect(solver.stats.jointOutputValidationAttempted).toBeTrue()
  expect(solver.stats.jointOutputAccepted).toBeTrue()
  expect(solver.stats.regionalB01RepairAttempted).toBeUndefined()
  expect(solver.stats.terminalEscapeCandidateCount).toBeUndefined()
  expect(
    solver.stats.pipeline7AdaptiveExactDrcFastProbeAttempted,
  ).toBeUndefined()
  const published = solver.getMutatedPreloadedTraces()
  expect(published).toHaveLength(1)
  expect(published[0]!.route[0]).toEqual(trace.route[0])
  expect(published[0]!.route.at(-1)).toEqual(trace.route.at(-1))
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: published,
    }).errors,
  ).toHaveLength(0)
  expect(srj).toEqual(originalSrj)
})
