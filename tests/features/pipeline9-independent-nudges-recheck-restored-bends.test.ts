import { expect, test } from "bun:test"
import { selectIndependentClearanceRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/selectIndependentClearanceRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("restoring a bend rechecks the new segment to its still-proposed neighbor", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes[1]!.route = [
    { x: -4, y: 3, z: 0 },
    { x: -1, y: 3.28, z: 0 },
    { x: 1, y: 3.28, z: 0 },
    { x: 4, y: 3, z: 0 },
  ]
  for (const obstacle of fixture.originalSrj.obstacles.slice(3)) {
    obstacle.center.y = 3
  }
  for (const point of fixture.originalSrj.connections[1]!.pointsToConnect) {
    point.y = 3
  }
  fixture.originalSrj.obstacles[2]!.center = { x: 0, y: 0.5 }
  fixture.originalSrj.obstacles.push({
    type: "rect",
    center: { x: 2.5, y: 0.5 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    connectedTo: ["blocker"],
    circuitJsonMetadata: { pcb_smtpad_id: "blocker" },
  })
  const original = structuredClone(fixture.routes)
  const proposedRoutes = structuredClone(fixture.routes)
  for (const pointIndex of [1, 2]) {
    proposedRoutes[0]!.route[pointIndex]!.y = 1
    proposedRoutes[1]!.route[pointIndex]!.y = 3.36
  }
  const selected = selectIndependentClearanceRepairs({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    proposedRoutes,
  })
  // The right bend hits the blocker. Restoring it makes the diagonal from
  // the left proposed bend cross the center pad, so both must be restored.
  expect(selected[0]).toEqual(original[0])
  expect(selected[1]).toEqual(proposedRoutes[1])
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  const after = fixture.drcEvaluator({ traces: [], routes: selected })
  expect(Array.isArray(before) ? before : before.errors).toHaveLength(1)
  expect(Array.isArray(after) ? after : after.errors).toHaveLength(0)
  expect(fixture.routes).toEqual(original)
  expect(proposedRoutes[0]!.route[1]!.y).toBe(1)
})
