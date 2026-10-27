import { expect, test } from "bun:test"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("clearance projection constrains immutable preload copper without returning it", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.originalSrj.obstacles = []
  fixture.routes[0]!.route = [
    { x: -4, y: 0.35, z: 0 },
    { x: 0, y: 0.1, z: 0 },
    { x: 4, y: 0.35, z: 0 },
  ]
  for (const point of fixture.originalSrj.connections[0]!.pointsToConnect) {
    point.y = 0.35
  }
  fixture.originalSrj.connections.push({
    name: "foreign",
    pointsToConnect: [
      { x: -3, y: 0, layer: "top", pcb_port_id: "foreign_start" },
      { x: 3, y: 0, layer: "top", pcb_port_id: "foreign_end" },
    ],
  })
  fixture.originalSrj.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed",
      connection_name: "foreign",
      route: [
        { route_type: "wire", x: -3, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 3, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const fixed: HighDensityRoute = {
    connectionName: "foreign",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -3, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ],
    vias: [],
  }
  const original = structuredClone(fixture.routes)
  const originalFixed = structuredClone(fixed)
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  expect(Array.isArray(before) ? before : before.errors).toHaveLength(1)
  const solver = new Pipeline9ClearanceProjectionSolver({
    ...fixture,
    fixedObstacleRoutes: [fixed],
    usePrecisionMargin: true,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  const routes = solver.getOutput()
  const validation = fixture.drcEvaluator({ traces: [], routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
  expect(routes).toHaveLength(1)
  expect(routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(fixed).toEqual(originalFixed)
  expect(fixture.routes).toEqual(original)
})
