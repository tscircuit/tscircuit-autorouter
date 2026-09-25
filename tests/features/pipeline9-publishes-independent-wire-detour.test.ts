import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createWireDetourFixture } from "../fixtures/pipeline9-wire-detour-fixture"

test("joint repair retains a safe detour when unrelated pad errors remain", (): void => {
  const fixture = createWireDetourFixture()
  const original = structuredClone(fixture.routes)
  const result = applyPipeline9BoundedRegionalRepairs({
    ...fixture,
    budget: { maxRegions: 0, maxCandidateAttempts: 4, maxPathSearchNodes: 30000 },
  })
  expect(result.routes[0]!.route.length).toBeGreaterThan(2)
  expect(result.routes[2]).toEqual(original[2])
  expect(result.publishedDrcIssueCount).toBe(1)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(4)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(30000)
  expect(fixture.routes).toEqual(original)
})
