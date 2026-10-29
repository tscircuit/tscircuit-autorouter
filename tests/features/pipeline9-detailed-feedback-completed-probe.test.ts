import { expect, test } from "bun:test"
import { Pipeline9DetailedFeedbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("a completed conflict-free probe cannot create feedback or claim changed work", (): void => {
  const params = createDetailedFeedbackFixture()
  const solver = new Pipeline9DetailedFeedbackSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.probeNodeCount).toBe(1)
  expect(solver.stats.probeWork).toBeGreaterThan(0)
  expect(solver.stats.unknownProbes).toBe(0)
  expect(solver.stats.physicalConflicts).toBe(0)
  expect(solver.stats.feedbackRegions).toBe(0)
  expect(solver.stats.replansStarted).toBe(0)
  expect(solver.stats.changedAssignments).toBe(0)
  expect(solver.stats.selectedReplan).toBe(false)
  expect(solver.selectedPathingSolver).toBe(params.initialPathingSolver)
  expect(solver.selectedDistributionSolver).toBe(params.initialDistributionSolver)
})
