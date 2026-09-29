import { expect, test } from "bun:test"
import { selectIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectIndependentClearanceRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("restoring a blocked neighbor rejects dependent moves but retains a separate repair", (): void => {
  const fixture = createBoundedRegionalRepairFixture(4)
  for (const [index, route] of fixture.routes.entries()) {
    const y = index < 3 ? 0.28 + index * 0.22 : 3.28
    route.route = [
      { x: -4, y: index, z: 0, pcb_port_id: `start_${index}` },
      { x: -1, y, z: 0 },
      { x: 1, y, z: 0 },
      { x: 4, y: index, z: 0, pcb_port_id: `end_${index}` },
    ]
  }
  fixture.originalSrj.obstacles = fixture.originalSrj.obstacles.filter(
    (_, index) => index !== 5 && index !== 8,
  )
  fixture.originalSrj.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0.95 },
    width: 0.4,
    height: 0.1,
    layers: ["top"],
    connectedTo: ["blocker"],
    circuitJsonMetadata: { pcb_smtpad_id: "blocker" },
  })
  const original = structuredClone(fixture.routes)
  const proposedRoutes = structuredClone(fixture.routes)
  for (const route of proposedRoutes) {
    route.route[1]!.y += 0.08
    route.route[2]!.y += 0.08
  }
  const selected = selectIndependentClearanceRepairs({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    proposedRoutes,
  })
  // The top move hits the blocker. Restoring it obstructs the middle move,
  // whose restoration then obstructs the bottom move on a later pass.
  expect(selected.slice(0, 3)).toEqual(original.slice(0, 3))
  expect(selected[3]).toEqual(proposedRoutes[3])
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  const after = fixture.drcEvaluator({ traces: [], routes: selected })
  const beforeErrors = Array.isArray(before) ? before : before.errors
  const afterErrors = Array.isArray(after) ? after : after.errors
  expect(beforeErrors).toHaveLength(2)
  expect(afterErrors).toHaveLength(1)
  expect(afterErrors[0]!.type).toBe("pcb_pad_trace_clearance_error")
  expect(afterErrors[0]!.pcb_trace_id).toBe(beforeErrors[0]!.pcb_trace_id)
  expect(fixture.routes).toEqual(original)
  expect(proposedRoutes[2]!.route[1]!.y).toBeCloseTo(0.8)
})
