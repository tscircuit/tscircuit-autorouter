import { expect, test } from "bun:test"
import { Pipeline9GridDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9GridDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "tests/fixtures/pipeline9-bounded-regional-repair-fixture"

test("grid repair preserves explicit via transitions and PCB port endpoints", () => {
  const fixture = createBoundedRegionalRepairFixture()
  const route = fixture.routes[0]!
  route.route[0]!.pcb_port_id = "start"
  fixture.originalSrj.connections[0]!.pointsToConnect[1]!.layer = "bottom"
  fixture.originalSrj.obstacles[1]!.layers = ["bottom"]
  route.route.push({ x: 4, y: 0, z: 1, pcb_port_id: "end" })
  route.vias.push({ x: 4, y: 0 })
  const original = structuredClone(route)
  const solver = new Pipeline9GridDrcRepairSolver({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    fixedRoutes: [],
    immutableConnectionNames: fixture.syntheticConnectionNames,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
    drcEvaluator: fixture.drcEvaluator,
    effort: 1,
  })
  solver.solve()
  const result = solver.getOutput()[0]!
  expect(solver.stats.gridRepairAcceptedCount).toBe(1)
  expect(result.vias).toEqual(original.vias)
  expect(result.route.filter((point) => point.pcb_port_id)).toEqual(
    original.route.filter((point) => point.pcb_port_id),
  )
  expect(result.route.filter((point) => point.z === 1)).toEqual(
    original.route.filter((point) => point.z === 1),
  )
  expect(result.viaDiameter).toBe(original.viaDiameter)
})
