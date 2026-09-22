import { expect, test } from "bun:test"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional projection repairs local clearance without moving a distant route", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  for (const [index, route] of fixture.routes.entries()) {
    route.route = [
      { x: -4, y: index, z: 0, pcb_port_id: `start_${index}` },
      { x: -1, y: index + 0.28, z: 0 },
      { x: 1, y: index + 0.28, z: 0 },
      { x: 4, y: index, z: 0, pcb_port_id: `end_${index}` },
    ]
  }
  const before = structuredClone(fixture.routes)
  const initial = fixture.drcEvaluator({ routes: before, traces: [] })
  expect(Array.isArray(initial) ? initial : initial.errors).toHaveLength(2)

  const routes = applyPipeline9ClearanceProjection({
    ...fixture,
    mutableBounds: { minX: -2, maxX: 2, minY: -0.6, maxY: 0.6 },
  })
  expect(routes[0]!.route).not.toEqual(before[0]!.route)
  expect(routes[1]).toEqual(before[1])
  expect(fixture.routes).toEqual(before)
  const after = fixture.drcEvaluator({ routes, traces: [] })
  expect(Array.isArray(after) ? after : after.errors).toHaveLength(1)
})
