import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createIndependentViaMergeFixture } from "../fixtures/pipeline9-independent-via-merge-fixture"

test("a via merge refreshes a wire proposal blocked by the old via location", (): void => {
  const fixture = createIndependentViaMergeFixture()
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0.28, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes[1]!.route = [
    { x: -3, y: 3, z: 0 },
    { x: 0, y: 0.64, z: 0 },
    { x: 0, y: 0.64, z: 1 },
    { x: 3, y: 3, z: 1 },
  ]
  fixture.routes[1]!.vias = [{ x: 0, y: 0.64 }]
  fixture.routes[2]!.route = [
    { x: 0, y: 0.86, z: 0 },
    { x: 0, y: 0.86, z: 1 },
    { x: 3, y: 3, z: 1 },
  ]
  fixture.routes[2]!.vias = [{ x: 0, y: 0.86 }]
  const original = structuredClone(fixture.routes)
  const result = applyPipeline9BoundedRegionalRepairs({
    ...fixture,
    syntheticConnectionNames: new Set(),
    budget: { maxRegions: 0, maxCandidateAttempts: 0, maxPathSearchNodes: 0 },
  })
  const reference = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(Array.isArray(reference) ? reference : reference.errors).toHaveLength(0)
  expect(result.publishedDrcIssueCount).toBe(0)
  expect(result.repaired).toBe(true)
  for (let index = 0; index < original.length; index++) {
    expect(result.routes[index]!.route[0]).toEqual(original[index]!.route[0])
    expect(result.routes[index]!.route.at(-1)).toEqual(
      original[index]!.route.at(-1),
    )
  }
  expect(fixture.routes).toEqual(original)
})
