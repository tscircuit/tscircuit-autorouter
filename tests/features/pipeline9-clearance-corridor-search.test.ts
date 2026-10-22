import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/FindClearancePathSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("clearance corridors route around hard copper and honor weighted blockers without a grid retry", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const route = fixture.routes[0]!
  const solver = new FindClearancePathSolver({
    srj: { ...fixture.originalSrj, traces: undefined }, routes: [route], routeIndex: 0,
    start: route.route[0]!, end: route.route.at(-1)!, bounds: fixture.originalSrj.bounds,
    traceThickness: route.traceThickness, traceClearance: 0.1, viaClearance: 0.1,
    allowLayerChanges: false, maxNodes: 10000,
    getAdditionalEdgeCost: (a, b): number => Math.max(a.y, b.y) > 0 ? Infinity : 0,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.stats).toMatchObject({ searchGraph: "corridors", completionReason: "found" })
  const path = solver.getOutput()!
  expect(path[0]).toEqual(route.route[0]!)
  expect(path.at(-1)).toEqual(route.route.at(-1)!)
  expect(path.length).toBeGreaterThan(2)
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1]!, b = path[index]!
    expect(a.z).toBe(0)
    expect(b.y).toBeLessThanOrEqual(0)
    expect(segmentToBoundsMinDistance(a, b, { minX: -0.2, maxX: 0.2, minY: -0.2, maxY: 0.2 })).toBeGreaterThanOrEqual(0.15 - 1e-8)
  }
  expect(solver.stats.nodesPopped).toBeLessThan(100)
})
