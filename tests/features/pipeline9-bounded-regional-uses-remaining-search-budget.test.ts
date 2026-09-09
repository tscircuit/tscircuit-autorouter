import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional repair visits independent contacts while search work remains", (): void => {
  const fixture = createBoundedRegionalRepairFixture(5)
  fixture.originalSrj.bounds.maxY = 70
  for (const obstacle of fixture.originalSrj.obstacles) obstacle.center.y *= 15
  for (const connection of fixture.originalSrj.connections) {
    for (const point of connection.pointsToConnect) point.y *= 15
  }
  for (const route of fixture.routes) {
    // Fixed terminals cannot clear the intervening pad through displacement.
    // Each independent span needs a regional path with new interior vertices.
    route.route = [route.route[0]!, route.route.at(-1)!].map((point) => ({
      ...point,
      y: point.y * 15,
    }))
  }
  const original = structuredClone(fixture.routes)
  const result = applyPipeline9BoundedRegionalRepairs(fixture)
  expect(result.initialDrcIssueCount).toBe(5)
  expect(result.repaired).toBeTrue()
  expect(result.finalDrcIssueCount).toBe(0)
  expect(result.attemptedRegionCount).toBe(5)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(1024)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(480_000)
  const reference = fixture.drcEvaluator({ routes: result.routes, traces: [] })
  expect(Array.isArray(reference) ? reference : reference.errors).toEqual([])
  for (let index = 0; index < result.routes.length; index++) {
    expect(result.routes[index]!.route[0]).toEqual(original[index]!.route[0])
    expect(result.routes[index]!.route.at(-1)).toEqual(
      original[index]!.route.at(-1),
    )
  }
  expect(fixture.routes).toEqual(original)
})
