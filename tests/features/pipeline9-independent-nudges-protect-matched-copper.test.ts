import { expect, test } from "bun:test"
import { selectIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectIndependentClearanceRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("partial projection cannot independently move a member of a matched group", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.originalSrj.buses = [
    {
      busId: "matched",
      name: "matched",
      connectionNames: ["signal"],
    },
  ]
  const proposedRoutes = structuredClone(fixture.routes)
  proposedRoutes[0]!.route[1]!.y = 1
  const selected = selectIndependentClearanceRepairs({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    proposedRoutes,
  })
  expect(selected).toEqual(fixture.routes)
})
