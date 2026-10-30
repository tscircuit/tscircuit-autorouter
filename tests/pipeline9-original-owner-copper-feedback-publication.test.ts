import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getPipeline9BoundedRepairBudget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("residual publication cannot trade away a strict contact or disable admission through mutable telemetry", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const solver = new Pipeline9JointDrcRepairSolver({ ...fixture.params, experimentOriginalOwnerCopperFeedback: true })
  const routes = structuredClone(fixture.params.newHdRoutes)
  solver["boundedRegionalRepairSolver"] = { solved: true,
    getResult: () => ({ routes, publishedDrcIssueCount: 0 }) } as unknown as NonNullable<typeof solver["boundedRegionalRepairSolver"]>
  solver["regionalB01RepairSolver"] = { solved: true,
    getResult: () => ({ routes }) } as unknown as NonNullable<typeof solver["regionalB01RepairSolver"]>
  solver["boundedRegionalParams"] = { budget: getPipeline9BoundedRepairBudget(2, 1, 1) } as NonNullable<typeof solver["boundedRegionalParams"]>
  solver["boundedRegionalRepairStartedAt"] = 0
  solver.stats.originalOwnerCopperFeedback.status = "NOT_APPLICABLE"
  solver["finishBoundedRegionalRepair"]()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe("Pipeline9 original-owner copper feedback retains 1 new selected copper violations")
  expect(solver["combinedOutput"]).toBeUndefined()
})
