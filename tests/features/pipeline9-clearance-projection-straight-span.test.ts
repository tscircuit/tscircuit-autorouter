import { expect, test } from "bun:test"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("partial projection bends a straight span while preserving terminals and an unrelated crossing", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  const route = fixture.routes[0]!
  route.route = [
    { x: -4, y: 0.28, z: 0, pcb_port_id: "start_0" },
    { x: 4, y: 0.28, z: 0, pcb_port_id: "end_0" },
  ]
  for (const point of fixture.originalSrj.connections[0]!.pointsToConnect) {
    point.y = 0.28
  }
  fixture.originalSrj.obstacles[0]!.center.y = 0.28
  fixture.originalSrj.obstacles[1]!.center.y = 0.28
  // This separate terminal-to-terminal pad crossing remains unresolved.
  fixture.routes[1]!.route.splice(1, 1)
  const original = structuredClone(fixture.routes)
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  const beforeErrors = Array.isArray(before) ? before : before.errors
  expect(
    beforeErrors.some(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    ),
  ).toBe(true)
  const originalProjection = new Pipeline9ClearanceProjectionSolver({
    ...fixture,
    allowPartialRepair: true,
  })
  originalProjection.solve()
  expect(originalProjection.getOutput()).toBe(fixture.routes)

  const solver = new Pipeline9ClearanceProjectionSolver({
    ...fixture,
    allowPartialRepair: true,
    subdivideSegments: true,
  })
  solver.solve()
  const routes = solver.getOutput()
  const after = fixture.drcEvaluator({ traces: [], routes })
  const errors = Array.isArray(after) ? after : after.errors
  expect(errors.length).toBeLessThan(beforeErrors.length)
  expect(
    errors.some((error) => error.type === "pcb_pad_trace_clearance_error"),
  ).toBe(false)
  expect(errors.some((error) => error.type === "pcb_trace_error")).toBe(true)
  expect(routes[0]!.route.length).toBeGreaterThan(2)
  expect(routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(routes[0]!.route.every((point) => point.z === 0)).toBe(true)
  expect(routes[0]!.traceThickness).toBe(original[0]!.traceThickness)
  expect(routes[0]!.vias).toEqual(original[0]!.vias)
  expect(routes[1]).toEqual(original[1])
  expect(fixture.routes).toEqual(original)
})
