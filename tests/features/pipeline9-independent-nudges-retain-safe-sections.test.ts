import { expect, test } from "bun:test"
import { selectIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectIndependentClearanceRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("a blocked section does not discard a separate safe repair on the same trace", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.originalSrj.obstacles[2]!.center = { x: -2, y: 0 }
  fixture.originalSrj.obstacles[5]!.center = { x: 2, y: 0 }
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -3, y: 0.28, z: 0 },
    { x: -1, y: 0.28, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 3, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes[1]!.route = [
    { x: -4, y: 1, z: 0 },
    { x: 1, y: 0.5, z: 0 },
    { x: 3, y: 0.5, z: 0 },
    { x: 4, y: 1, z: 0 },
  ]
  const original = structuredClone(fixture.routes)
  const proposedRoutes = structuredClone(fixture.routes)
  for (const index of [1, 2, 4, 5]) {
    proposedRoutes[0]!.route[index]!.y = 0.36
  }
  const selected = selectIndependentClearanceRepairs({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    proposedRoutes,
  })
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  const after = fixture.drcEvaluator({ traces: [], routes: selected })
  const beforeErrors = Array.isArray(before) ? before : before.errors
  const afterErrors = Array.isArray(after) ? after : after.errors
  expect(beforeErrors).toHaveLength(2)
  expect(afterErrors).toHaveLength(1)
  expect(afterErrors[0]!.type).toBe("pcb_pad_trace_clearance_error")
  expect(selected[0]!.route.slice(1, 3)).toEqual(
    proposedRoutes[0]!.route.slice(1, 3),
  )
  expect(selected[0]!.route.slice(3)).toEqual(original[0]!.route.slice(3))
  expect(selected[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(selected[1]).toEqual(original[1])
  expect(fixture.routes).toEqual(original)
})
