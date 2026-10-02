import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded regional repair clears physical copper without moving its terminals", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const original = structuredClone(fixture.routes)
  const solver = new Pipeline9BoundedRegionalRepairSolver(fixture)
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  expect(result.repaired).toBeTrue()
  expect(result.initialDrcIssueCount).toBeGreaterThan(0)
  expect(result.finalDrcIssueCount).toBe(0)
  expect(result.routes).not.toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
  expect(result.routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(4)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(4 * 256)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(4 * 120_000)
  expect(result.referenceValidationCount).toBeGreaterThan(1)
  const validation = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
})
