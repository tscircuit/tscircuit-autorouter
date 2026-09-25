import { expect, test } from "bun:test"
import { selectIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectIndependentClearanceRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("a rejected section is reconsidered after its blocking neighbor moves", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.originalSrj.obstacles = fixture.originalSrj.obstacles.filter(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id !== "foreign_pad_1",
  )
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0.28, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes[1]!.route = [
    { x: -4, y: 1, z: 0 },
    { x: -1, y: 0.5, z: 0 },
    { x: 1, y: 0.5, z: 0 },
    { x: 4, y: 1, z: 0 },
  ]
  const original = structuredClone(fixture.routes)
  const proposedRoutes = structuredClone(fixture.routes)
  proposedRoutes[0]!.route[1]!.y = 0.36
  proposedRoutes[0]!.route[2]!.y = 0.36
  proposedRoutes[1]!.route[1]!.y = 0.7
  proposedRoutes[1]!.route[2]!.y = 0.7
  const selected = selectIndependentClearanceRepairs({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    proposedRoutes,
  })
  expect(selected).toEqual(proposedRoutes)
  const reversed = selectIndependentClearanceRepairs({
    srj: fixture.originalSrj,
    routes: [...fixture.routes].reverse(),
    proposedRoutes: [...proposedRoutes].reverse(),
  })
  expect(reversed.reverse()).toEqual(selected)
  const result = fixture.drcEvaluator({ traces: [], routes: selected })
  expect(Array.isArray(result) ? result : result.errors).toHaveLength(0)
  expect(fixture.routes).toEqual(original)
})
