import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional repair owns materialized preloaded sections", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const original = structuredClone(fixture.routes)
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    syntheticConnectionNames: new Set(
      fixture.routes.map((route) => route.connectionName),
    ),
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const result = solver.getResult()
  expect(result.repaired).toBeTrue()
  expect(result.publishedDrcIssueCount).toBe(0)
  expect(fixture.routes).toEqual(original)
  expect(result.routes[0]!.connectionName).toBe(original[0]!.connectionName)
  expect(result.routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
})
