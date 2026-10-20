import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional layer changes place new vias outside the declared pad clearance", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route.splice(1, 1)
  fixture.originalSrj.obstacles[2]!.width = 1
  fixture.originalSrj.obstacles[2]!.height = 7
  fixture.originalSrj.minPadEdgeToPadEdgeClearance = 0.5
  const original = structuredClone(fixture.routes)
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 256,
      maxPathSearchNodes: 480_000,
      regionSizes: [10],
    },
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  const validation = fixture.drcEvaluator({
    routes: result.routes,
    traces: [],
  })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
  expect(result.routes[0]!.vias).toHaveLength(2)
  expect(result.repaired).toBeTrue()
  expect(result.routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(fixture.routes).toEqual(original)
})
