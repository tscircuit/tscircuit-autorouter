import { expect, test } from "bun:test"
import { selectIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectIndependentClearanceRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("neighboring trace moves clear a pad together regardless of route order", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  for (const [index, route] of fixture.routes.entries()) {
    const y = index === 0 ? 0.28 : 0.5
    route.route = [
      { x: -4, y: index, z: 0, pcb_port_id: `start_${index}` },
      { x: -1, y, z: 0 },
      { x: 1, y, z: 0 },
      { x: 4, y: index, z: 0, pcb_port_id: `end_${index}` },
    ]
  }
  const original = structuredClone(fixture.routes)
  const proposedRoutes = structuredClone(fixture.routes)
  for (const route of proposedRoutes) {
    route.route[1]!.y += 0.08
    route.route[2]!.y += 0.08
  }
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  expect(Array.isArray(before) ? before : before.errors).toHaveLength(1)
  for (const reverse of [false, true]) {
    const selected = selectIndependentClearanceRepairs({
      srj: fixture.originalSrj,
      routes: reverse ? fixture.routes.toReversed() : fixture.routes,
      proposedRoutes: reverse ? proposedRoutes.toReversed() : proposedRoutes,
    })
    const routes = reverse ? selected.toReversed() : selected
    const after = fixture.drcEvaluator({ traces: [], routes })
    expect(Array.isArray(after) ? after : after.errors).toHaveLength(0)
    expect(routes).toEqual(proposedRoutes)
    for (const [index, route] of routes.entries()) {
      expect(route.route[0]).toEqual(original[index]!.route[0])
      expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
      expect(route.vias).toEqual(original[index]!.vias)
    }
  }
  expect(fixture.routes).toEqual(original)
})
