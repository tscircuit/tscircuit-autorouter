import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("initial DRC cache matches a fresh reference evaluation and rejects changed trace IDs", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  const makeSolver = (
    routes: HighDensityRoute[],
    duplicateConnection = false,
  ): Pipeline9JointDrcRepairSolver =>
    new Pipeline9JointDrcRepairSolver({
      srj,
      srjWithPointPairs: srj,
      originalSrj: srj,
      newConnections: duplicateConnection
        ? [srj.connections[0]!, structuredClone(srj.connections[0]!)]
        : srj.connections,
      newHdRoutes: routes,
      updatedPreloadedTraces: [],
      mutatedPreloadedTraceIds: new Set(),
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      obstacles: srj.obstacles,
      layerCount: srj.layerCount,
      defaultViaDiameter: 0.3,
      defaultViaHoleDiameter: 0.15,
      effort: 1,
      colorMap: {},
    })
  const solver = makeSolver(fixture.routes)
  const state = solver as unknown as {
    cachedReferenceDrcEvaluator: DrcEvaluator
    referenceDrcValidationCount: number
  }
  const evaluate = (routes: HighDensityRoute[]): ReturnType<DrcEvaluator> =>
    state.cachedReferenceDrcEvaluator({ traces: [], routes, hdRoutes: routes })
  const seeded = evaluate(fixture.routes)
  expect(state.referenceDrcValidationCount).toBe(0)
  const reordered = fixture.routes.map((route) =>
    Object.fromEntries(Object.entries(route).reverse()) as HighDensityRoute,
  )
  expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(fixture.routes))
  const fresh = evaluate(reordered)
  expect(state.referenceDrcValidationCount).toBe(1)
  expect(seeded).toEqual(fresh)
  if (Array.isArray(seeded) || Array.isArray(fresh)) throw new Error("Expected centered DRC results")
  expect(seeded.errors.length).toBeGreaterThan(0)
  expect(seeded.errorsWithCenters).toEqual(fresh.errorsWithCenters)

  // Candidate conversion must rename duplicate trace IDs, so the constructor
  // snapshot cannot be seeded for this different evaluated circuit.
  const duplicated = fixture.routes
  const duplicateSolver = makeSolver(duplicated, true)
  const duplicateState = duplicateSolver as unknown as typeof state
  duplicateState.cachedReferenceDrcEvaluator({ traces: [], routes: duplicated, hdRoutes: duplicated })
  expect(duplicateState.referenceDrcValidationCount).toBe(1)

  srj.traces = [{
    type: "pcb_trace",
    pcb_trace_id: "preloaded",
    connection_name: "preloaded",
    route: [
      { route_type: "wire", x: -4, y: 6, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 4, y: 6, width: 0.1, layer: "bottom" },
    ],
  }]
  const preloadedSolver = makeSolver(fixture.routes)
  const preloadedState = preloadedSolver as unknown as typeof state
  preloadedState.cachedReferenceDrcEvaluator({ traces: [], routes: fixture.routes, hdRoutes: fixture.routes })
  expect(preloadedState.referenceDrcValidationCount).toBe(1)
})
