import { expect, test } from "bun:test"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("coupled projection adds a clearance bend without moving terminal copper", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route = [
    { x: -4, y: 0.28, z: 0, pcb_port_id: "start" },
    { x: 4, y: 0.28, z: 0, pcb_port_id: "end" },
  ]
  for (const point of fixture.originalSrj.connections[0]!.pointsToConnect) {
    point.y = 0.28
  }
  fixture.originalSrj.obstacles[0]!.center.y = 0.28
  fixture.originalSrj.obstacles[1]!.center.y = 0.28
  const original = structuredClone(fixture.routes)
  const originalProjection = new Pipeline9ClearanceProjectionSolver(fixture)
  originalProjection.solve()
  expect(originalProjection.getOutput()).toBe(fixture.routes)

  const solver = new Pipeline9ClearanceProjectionSolver({
    ...fixture,
    subdivideSegments: true,
    usePrecisionMargin: true,
  })
  solver.solve()
  const routes = solver.getOutput()
  const reference = fixture.drcEvaluator({ traces: [], routes })
  expect(Array.isArray(reference) ? reference : reference.errors).toHaveLength(
    0,
  )
  expect(routes[0]!.route.length).toBeGreaterThan(2)
  expect(routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(routes[0]!.traceThickness).toBe(original[0]!.traceThickness)
  expect(routes[0]!.vias).toEqual(original[0]!.vias)
  expect(fixture.routes).toEqual(original)
})
