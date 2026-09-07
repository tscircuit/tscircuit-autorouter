import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 inherited native failures never start another repair strategy", (): void => {
  for (const failureMode of ["failed", "throw"] as const) {
    const { srj, originalSrj, trace, solver } =
      createPipeline9InheritedPadClearanceFixture()
    const native = solver.exactRepairSolver
    if (!(native instanceof GlobalDrcForceImproveSolver)) {
      throw new Error("Expected the inherited native repair leaf")
    }
    const originalRoutes = solver.getOutput()
    const originalPreloads = solver.getUpdatedPreloadedTraces()
    const expectedFailure = new Error(`Controlled native ${failureMode}`)
    // Instance-local fault injection verifies handoff behavior without changing
    // any real solver implementation or another concurrently running test.
    native.step = (): void => {
      if (failureMode === "throw") throw expectedFailure
      native.failed = true
      native.error = expectedFailure.message
    }

    if (failureMode === "throw") {
      expect((): void => solver.step()).toThrow(expectedFailure.message)
    } else {
      solver.step()
    }

    expect(solver.failed).toBeTrue()
    expect(solver.solved).toBeFalse()
    expect(solver.error).toContain(expectedFailure.message)
    expect(solver.exactRepairSolver).toBe(native)
    expect(solver.activeSubSolver).toBe(native)
    expect(native.activeSubSolver).toBeUndefined()
    expect(solver.stats.jointOutputValidationAttempted).toBeFalse()
    expect(solver.stats.jointOutputAccepted).toBeFalse()
    expect(solver.stats.regionalB01RepairAttempted).toBeUndefined()
    expect(solver.getOutput()).toBe(originalRoutes)
    expect(solver.getUpdatedPreloadedTraces()).toBe(originalPreloads)
    expect(solver.getUpdatedPreloadedTraces()[0]).toBe(trace)
    expect(solver.getMutatedPreloadedTraces()).toEqual([])
    expect(srj).toEqual(originalSrj)
  }
})
