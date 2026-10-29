import { expect, test } from "bun:test"
import { Pipeline9DetailedFeedbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("explicit planning exhaustion selects only completed original assignments and reports all spent work", (): void => {
  for (const effort of [0.00001, 0.00005, 0.0001]) {
    const params = createDetailedFeedbackFixture()
    params.probeStepsPerNode = 3
    params.highDensityParams.effort = effort
    const solver = new Pipeline9DetailedFeedbackSolver(params)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.stats.budgetExhausted).toBe(true)
    expect(solver.stats.selectedReplan).toBe(false)
    expect(solver.stats.changedAssignments).toBe(0)
    expect(solver.selectedPathingSolver).toBe(params.initialPathingSolver)
    expect(solver.selectedDistributionSolver).toBe(params.initialDistributionSolver)
    expect(solver.stats.chargedWork).toBe(solver.stats.setupWork + solver.stats.probeWork + solver.stats.replanWork)
    if (effort === 0.0001) {
      // A completed global proposal still cannot be selected if redistribution
      // exhausts the budget. No partial proposal leaks to final HD.
      expect(solver.stats.replansCompleted).toBe(1)
      expect(solver.stats.replansStarted).toBe(1)
    }
  }
})
