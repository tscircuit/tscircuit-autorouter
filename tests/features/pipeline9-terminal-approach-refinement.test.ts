import { expect, test } from "bun:test"
import { applyBroadRepulsionForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { restorePipeline9TerminalApproaches } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/restorePipeline9TerminalApproaches"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("clearance refinement retains terminal stubs while routing a clean detour", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0, pcb_port_id: "start" },
    { x: -3.9, y: 0.1, z: 0, terminalApproach: "start" },
    { x: 3.9, y: 0.1, z: 0, terminalApproach: "end" },
    { x: 4, y: 0, z: 0, pcb_port_id: "end" },
  ]
  const original = structuredClone(fixture.routes)
  const expectedApproaches = original[0]!.route.slice(1, -1)
  const forceRoutes = applyBroadRepulsionForces(
    { ...fixture.originalSrj, traces: undefined },
    fixture.routes,
    1,
  )
  // The broad helper has no internal-anchor API and moves these short stubs
  // out of their pads while resolving the separate middle-pad collision.
  expect(forceRoutes[0]!.route.slice(1, -1)).not.toEqual(expectedApproaches)
  const restored = restorePipeline9TerminalApproaches(
    fixture.routes,
    forceRoutes,
  )!
  expect(restored[0]!.route).toEqual(original[0]!.route)

  const projection = new Pipeline9ClearanceProjectionSolver({
    ...fixture,
    routes: restored,
  })
  projection.solve()
  expect(projection.failed).toBeFalse()
  const projected = projection.getOutput()
  expect(projected[0]!.route).toEqual(original[0]!.route)

  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    routes: projected,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  const result = solver.getResult()
  expect(result.initialDrcIssueCount).toBe(1)
  expect(result.acceptedRegionCount).toBeGreaterThan(0)
  const reference = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(Array.isArray(reference) ? reference : reference.errors).toEqual([])
  const output = result.routes[0]!
  expect(output.route[0]).toEqual(original[0]!.route[0])
  expect(output.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(output.route.filter((point) => point.terminalApproach)).toEqual(
    expectedApproaches,
  )
  expect(output.route.filter((point) => point.pcb_port_id)).toEqual([
    original[0]!.route[0]!,
    original[0]!.route.at(-1)!,
  ])
  expect(output.traceThickness).toBe(original[0]!.traceThickness)
  expect(output.viaDiameter).toBe(original[0]!.viaDiameter)
  expect(fixture.routes).toEqual(original)

  // A copied approach tag cannot identify which force-created vertex is the
  // original anchor; reject that candidate instead of guessing its position.
  const ambiguous: HighDensityRoute[] = structuredClone(forceRoutes)
  ambiguous[0]!.route.splice(1, 0, { ...ambiguous[0]!.route[1]! })
  expect(
    restorePipeline9TerminalApproaches(fixture.routes, ambiguous),
  ).toBeUndefined()
})
