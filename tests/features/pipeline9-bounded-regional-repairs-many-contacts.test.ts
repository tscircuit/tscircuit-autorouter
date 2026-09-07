import { getNewViaPadViolations } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded regional repair handles many physical contacts within its work budget", (): void => {
  const fixture = createBoundedRegionalRepairFixture(9)
  const original = structuredClone(fixture.routes)
  const result = applyPipeline9BoundedRegionalRepairs(fixture)
  expect(result.initialDrcIssueCount).toBeGreaterThan(8)
  expect(result.attemptedRegionCount).toBeGreaterThan(0)
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(4)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(4 * 256)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(4 * 120_000)
  expect(result.referenceValidationCount).toBeGreaterThan(1)
  expect(result.repaired).toBeTrue()
  expect(result.finalDrcIssueCount).toBe(0)
  expect(fixture.routes).toEqual(original)
  for (let index = 0; index < original.length; index++) {
    expect(result.routes[index]!.route[0]).toEqual(original[index]!.route[0])
    expect(result.routes[index]!.route.at(-1)).toEqual(
      original[index]!.route.at(-1),
    )
  }
  expect(
    getNewViaPadViolations({
      srj: { ...fixture.originalSrj, traces: undefined },
      previousRoutes: fixture.routes,
      routes: result.routes,
    }),
  ).toHaveLength(0)
  const validation = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
})
