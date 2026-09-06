import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createPipeline9JointFinalReferenceFixture } from "../fixtures/pipeline9-joint-final-reference-fixture"

test("joint repair rejects a worsening optimization and retains exact input routes and preloaded replacements", (): void => {
  const { fixture, params, evaluator } =
    createPipeline9JointFinalReferenceFixture()
  const expected = structuredClone({
    routes: params.newHdRoutes,
    preloads: params.updatedPreloadedTraces,
  })
  const solver = new Pipeline9JointDrcRepairSolver(params)
  expect(solver.solved).toBe(true)
  expect(solver.stats.outputFinalReferenceDrcIssueCount).toBe(0)
  const candidate = structuredClone(fixture.hdRoutes)
  for (const point of candidate[0]!.route)
    if (Math.abs(point.x) <= 1) point.y = 0.6
  expect(
    evaluator({
      newHdRoutes: candidate,
      updatedPreloadedTraces: params.updatedPreloadedTraces,
      mutatedPreloadedTraces: params.updatedPreloadedTraces,
    }),
  ).toBeGreaterThan(0)
  // Inject a valid optimization proposal at the acceptance boundary, avoiding
  // a dependency on the portfolio's heuristic ordering to create a regression.
  const access = solver as unknown as {
    combinedOutput: HighDensityRoute[]
    solved: boolean
  }
  access.combinedOutput = candidate
  access.solved = false
  solver.step()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats).toMatchObject({
    initialFinalReferenceDrcIssueCount: 0,
    candidateFinalReferenceDrcIssueCount: 1,
    outputFinalReferenceDrcIssueCount: 0,
    rejectedOptimizationCandidate: true,
  })
  expect(solver.getOutput()).toEqual(expected.routes)
  expect(solver.getUpdatedPreloadedTraces()).toEqual(expected.preloads)
  expect(solver.getMutatedPreloadedTraces()).toEqual(expected.preloads)
  expect(params.newHdRoutes).toEqual(expected.routes)
  expect(params.updatedPreloadedTraces).toEqual(expected.preloads)
})
