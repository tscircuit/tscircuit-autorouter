import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { getCurrentCircuitJson } from "lib/testing/autorouting-pipeline-debugger/getCurrentCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import bugReport from "../../fixtures/bug-reports/bugreport94-56fa2e/bugreport94-56fa2e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport94-56fa2e.json with Pipeline 9", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
  )
  const logHighDensityErrors = (event: string): void => {
    const repair = solver.highDensityDrcRepairSolver
    if (!repair) return
    console.info(
      JSON.stringify({
        fixture: "bugreport94-56fa2e",
        stage: "highDensityDrcRepairSolver",
        event,
        errorCount: repair.currentErrors.length,
      }),
    )
    // These are the stage's existing official evaluations, not extra checks.
    // Separate error records keep even a large initial report below log limits.
    for (const [errorIndex, error] of repair.currentErrors.entries()) {
      console.info(
        JSON.stringify({
          fixture: "bugreport94-56fa2e",
          stage: "highDensityDrcRepairSolver",
          event,
          errorIndex,
          error,
        }),
      )
    }
  }
  let initialHighDensityErrorsLogged = false
  let stageElapsedTimeMs = 0
  let totalSolverElapsedTimeMs = 0
  while (!solver.solved && !solver.failed) {
    const stage = solver.getCurrentPhase()
    const stepStartedAt = performance.now()
    solver.step()
    const stepElapsedTimeMs = performance.now() - stepStartedAt
    stageElapsedTimeMs += stepElapsedTimeMs
    totalSolverElapsedTimeMs += stepElapsedTimeMs
    const highDensityRepair = solver.highDensityDrcRepairSolver
    if (
      !initialHighDensityErrorsLogged &&
      highDensityRepair &&
      highDensityRepair.iterations > 0
    ) {
      logHighDensityErrors("before-hd-repair")
      initialHighDensityErrorsLogged = true
    }
    if (solver.getCurrentPhase() === stage) continue
    const repairStats =
      stage === "highDensityDrcRepairSolver"
        ? solver.highDensityDrcRepairSolver?.stats
        : stage === "globalDrcForceImproveSolver"
          ? solver.globalDrcForceImproveSolver?.stats
          : stage === "pipeline9JointDrcRepairSolver"
            ? solver.pipeline9JointDrcRepairSolver?.stats
            : undefined
    console.info(
      JSON.stringify({
        fixture: "bugreport94-56fa2e",
        stage,
        event: "complete",
        elapsedTimeMs: stageElapsedTimeMs,
        stats: repairStats,
      }),
    )
    if (stage === "highDensityDrcRepairSolver") {
      logHighDensityErrors("after-hd-repair")
    }
    stageElapsedTimeMs = 0
  }
  // Preserve solve()'s timing field while excluding diagnostic logging time.
  solver.timeToSolve = totalSolverElapsedTimeMs

  const circuitJson = getCurrentCircuitJson(solver)
  expect(circuitJson).not.toBeNull()
  const { errors } = getDrcErrors(circuitJson!)
  console.info(
    JSON.stringify({
      fixture: "bugreport94-56fa2e",
      stage: "final",
      event: "existing-final-drc-check",
      elapsedTimeMs: totalSolverElapsedTimeMs,
      solved: solver.solved,
      failed: solver.failed,
      errorCount: errors.length,
    }),
  )
  for (const [errorIndex, error] of errors.entries()) {
    console.info(
      JSON.stringify({
        fixture: "bugreport94-56fa2e",
        stage: "final",
        errorIndex,
        error,
      }),
    )
  }
  expect(errors.length).toBeLessThanOrEqual(5)
  const targetOverlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_108") &&
      error.pcb_trace_error_id.includes("source_trace_138"),
  )
  expect(targetOverlap).toBeUndefined()
  const transferredOverlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_108"),
  )
  expect(transferredOverlap).toBeUndefined()

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
}, 300_000)
