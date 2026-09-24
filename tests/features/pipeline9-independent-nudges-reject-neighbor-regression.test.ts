import { expect, test } from "bun:test"
import { selectIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectIndependentClearanceRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("a projected pad repair cannot create a new trace conflict beside it", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0.28, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes[1]!.route = [
    { x: -1, y: 0.5, z: 0 },
    { x: 1, y: 0.5, z: 0 },
  ]
  const proposedRoutes = structuredClone(fixture.routes)
  proposedRoutes[0]!.route[1]!.y = 0.36
  proposedRoutes[0]!.route[2]!.y = 0.36
  const selected = selectIndependentClearanceRepairs({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    proposedRoutes,
  })
  expect(selected).toEqual(fixture.routes)
})
