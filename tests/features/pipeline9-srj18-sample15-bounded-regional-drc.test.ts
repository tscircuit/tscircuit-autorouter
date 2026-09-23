import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixture from "../fixtures/pipeline9-stalled-regional-context.json"

// Cropped from SRJ18 sample 15. Fixed points at the smaller region's collar
// block coupled routes; retrying that context spends the remaining search work.
test("regional repair expands a stalled context before exhausting its shared budget", (): void => {
  const originalSrj = fixture.originalSrj as SimpleRouteJson
  const routes = structuredClone(fixture.routes) as HighDensityRoute[]
  const originalRoutes = structuredClone(routes)
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const convert = createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
    connections: originalSrj.connections,
    originalConnections: originalSrj.connections,
    layerCount: originalSrj.layerCount,
    obstacles: originalSrj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const evaluatedRoutes = candidate ?? hdRoutes
    if (!evaluatedRoutes) throw new Error("Missing candidate geometry")
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convert(evaluatedRoutes),
    }) as unknown as ReturnType<DrcEvaluator>
  }
  const budget = {
    maxRegions: 8,
    maxCandidateAttempts: 1_024,
    maxPathSearchNodes: 2_603_036,
    maxCandidateAttemptsPerRegion: 133,
    maxPathSearchNodesPerCall: 500_000,
    pathGridSizeScale: 2,
    pathHeuristicWeight: 3,
    revisitChangedRegions: true,
  }
  const result = applyPipeline9BoundedRegionalRepairs({
    originalSrj,
    routes,
    connMap,
    syntheticConnectionNames: new Set(),
    viaHoleDiameter: 0.15,
    drcEvaluator,
    budget,
  })
  expect(result.initialDrcIssueCount).toBe(117)
  expect(result.repaired).toBeTrue()
  expect(result.finalDrcIssueCount).toBe(0)
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(budget.maxRegions)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(
    budget.maxCandidateAttempts,
  )
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(
    budget.maxPathSearchNodes,
  )
  expect(routes).toEqual(originalRoutes)
  const validation = drcEvaluator({ traces: [], routes: result.routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
})
