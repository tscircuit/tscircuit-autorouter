import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createScatteredBoundedRegionalRepairFixture } from "../fixtures/createScatteredBoundedRegionalRepairFixture"

test("a blocked regional search stops at its initial allowance without earning work", (): void => {
  const fixture = createScatteredBoundedRegionalRepairFixture()
  // Both layer-spanning walls extend beyond either regional search context.
  for (const obstacle of [
    fixture.originalSrj.obstacles[2]!,
    fixture.originalSrj.obstacles[5]!,
  ]) {
    obstacle.height = 20
    obstacle.layers = ["top", "bottom"]
  }
  const original = structuredClone(fixture.routes)
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    budget: {
      maxRegions: 2,
      maxCandidateAttempts: 2,
      maxPathSearchNodes: 10_000,
      initialMaxRegions: 1,
      initialMaxCandidateAttempts: 1,
      initialMaxPathSearchNodes: 5_000,
      regionsPerAcceptedRepair: 1,
      candidateAttemptsPerAcceptedRepair: 1,
      pathSearchNodesPerAcceptedRepair: 5_000,
    },
  })
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  expect(result.initialDrcIssueCount).toBe(2)
  expect(result.acceptedRegionCount).toBe(0)
  expect(result.attemptedRegionCount).toBe(1)
  expect(result.candidateAttemptCount).toBe(1)
  expect(result.pathSearchNodeCount).toBe(5_000)
  expect(solver.stats.allowedRegionCount).toBe(1)
  expect(solver.stats.allowedCandidateAttemptCount).toBe(1)
  expect(solver.stats.allowedPathSearchNodeCount).toBe(5_000)
  expect(result.repaired).toBeFalse()
  expect(result.publishedDrcIssueCount).toBe(2)
  expect(result.routes).toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
  const validation = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(2)
})
