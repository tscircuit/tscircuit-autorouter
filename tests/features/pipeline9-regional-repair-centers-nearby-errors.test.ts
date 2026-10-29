import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("one repair region covers nearby pad errors that otherwise fall in its collar", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  for (const obstacle of fixture.originalSrj.obstacles) {
    if (obstacle.center.y === 1) obstacle.center.y = 5
  }
  for (const point of fixture.originalSrj.connections[1]!.pointsToConnect) {
    point.y = 5
  }
  for (const point of fixture.routes[1]!.route) point.y = 5
  const original = structuredClone(fixture.routes)
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 1024,
      maxPathSearchNodes: 480_000,
    },
  })
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  expect(fixture.routes).toEqual(original)
  expect(result.attemptedRegionCount).toBe(1)
  expect(result.repaired).toBe(true)
  expect(result.publishedDrcIssueCount).toBe(0)
  const validation = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
})
