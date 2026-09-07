import { expect, test } from "bun:test"
import { getNewViaPadViolations } from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixture from "../fixtures/pipeline9-regional-context.json"

// Reduced from the hosted SRJ18 sample 4 output: nearby routed copper keeps
// two trace errors unresolved inside a 10 mm region's locked collar.
test("bounded regional repair expands context for errors inside an attempted region", (): void => {
  const originalSrj = fixture.originalSrj as SimpleRouteJson
  const routes = structuredClone(fixture.routes) as HighDensityRoute[]
  const originalRoutes = structuredClone(routes)
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const evaluatedRoutes = candidate ?? hdRoutes
    if (!evaluatedRoutes) throw new Error("Missing candidate geometry")
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: originalSrj.connections,
        originalConnections: originalSrj.connections,
        hdRoutes: evaluatedRoutes,
        layerCount: originalSrj.layerCount,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    }) as unknown as ReturnType<DrcEvaluator>
  }
  const result = applyPipeline9BoundedRegionalRepairs({
    originalSrj,
    routes,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
  })
  expect(result.initialDrcIssueCount).toBe(4)
  expect(result.repaired).toBeTrue()
  expect(result.finalDrcIssueCount).toBe(0)
  expect(result.attemptedRegionCount).toBeGreaterThan(1)
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(4)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(4 * 256)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(4 * 120_000)
  expect(routes).toEqual(originalRoutes)
  for (let index = 0; index < routes.length; index++) {
    expect(result.routes[index]!.route[0]).toEqual(routes[index]!.route[0])
    expect(result.routes[index]!.route.at(-1)).toEqual(
      routes[index]!.route.at(-1),
    )
    expect(result.routes[index]!.traceThickness).toBe(
      routes[index]!.traceThickness,
    )
    expect(result.routes[index]!.viaDiameter).toBe(routes[index]!.viaDiameter)
  }
  expect(
    getNewViaPadViolations({
      srj: originalSrj,
      previousRoutes: routes,
      routes: result.routes,
    }),
  ).toHaveLength(0)
  const validation = drcEvaluator({ traces: [], routes: result.routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
})
