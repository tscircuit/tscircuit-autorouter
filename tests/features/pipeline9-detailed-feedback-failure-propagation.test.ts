import { expect, test } from "bun:test"
import { Pipeline9DetailedFeedbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("a real child failure is propagated rather than being treated as UNKNOWN feedback", (): void => {
  const params = createDetailedFeedbackFixture()
  const solver = new Pipeline9DetailedFeedbackSolver(params)
  solver.step()
  const actualProbe = solver.activeSubSolver
  expect(actualProbe).toBeInstanceOf(Pipeline9HighDensitySolver)
  // Inject the native failure boundary. This must never reach repricing.
  actualProbe!.failed = true
  actualProbe!.error = "native invariant control"
  solver.step()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe("native invariant control")
  expect(solver.stats.unknownProbes).toBe(0)
  expect(solver.stats.replansStarted).toBe(0)
  expect(solver.stats.changedAssignments).toBe(0)
  expect(solver.stats.selectedReplan).toBe(false)
  expect(solver.selectedPathingSolver).toBe(params.initialPathingSolver)
})
