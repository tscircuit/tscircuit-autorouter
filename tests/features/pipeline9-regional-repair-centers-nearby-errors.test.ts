import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
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
  const result = applyPipeline9BoundedRegionalRepairs({
    ...fixture,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 1024,
      maxPathSearchNodes: 480_000,
    },
  })
  expect(fixture.routes).toEqual(original)
  expect(result.attemptedRegionCount).toBe(1)
  expect(result.repaired).toBe(true)
  expect(result.publishedDrcIssueCount).toBe(0)
  const validation = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
})
