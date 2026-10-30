import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("an unchanged inherited original copper contact is not mistaken for a new strict repair requirement", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const before = fixture.evaluate(fixture.params.newHdRoutes).traces
  fixture.params.originalSrj.traces = structuredClone(before)
  fixture.params.updatedPreloadedTraces = structuredClone(before)
  fixture.params.newConnections = []
  fixture.params.newHdRoutes = []
  const solver = new Pipeline9JointDrcRepairSolver({ ...fixture.params, experimentOriginalOwnerCopperFeedback: true })
  expect(solver.stats.originalOwnerCopperFeedback).toMatchObject({ status: "SUPPORTED", baselineIssueCount: 1, initialIssueCount: 1 })
  expect(solver.stats.originalOwnerCopperFeedback.baselineMatchesFiltered).toBe(2)
  expect(solver.stats.initialJointDrcIssueCount).toBe(0)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toEqual([])
  expect(solver.getUpdatedPreloadedTraces()).toEqual(before)
})
