import { expect, test } from "bun:test"
import { selectIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectIndependentClearanceRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("conflicting proposals still retain a repair that clears the restored neighbor", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  for (const [index, route] of fixture.routes.entries()) {
    const y = index === 0 ? 0.28 : 0.6
    route.route = [
      { x: -4, y: index, z: 0 },
      { x: -1, y, z: 0 },
      { x: 1, y, z: 0 },
      { x: 4, y: index, z: 0 },
    ]
  }
  const original = structuredClone(fixture.routes)
  const proposedRoutes = structuredClone(fixture.routes)
  for (const pointIndex of [1, 2]) {
    proposedRoutes[0]!.route[pointIndex]!.y = 0.36
    proposedRoutes[1]!.route[pointIndex]!.y = 0.5
  }
  const selected = selectIndependentClearanceRepairs({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    proposedRoutes,
  })
  expect(selected[0]).toEqual(proposedRoutes[0])
  expect(selected[1]).toEqual(original[1])
  const after = fixture.drcEvaluator({ traces: [], routes: selected })
  expect(Array.isArray(after) ? after : after.errors).toHaveLength(0)
  expect(fixture.routes).toEqual(original)
})
