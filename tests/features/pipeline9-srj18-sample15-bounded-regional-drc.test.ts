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
test("regional repair clears coupled trace errors while reporting existing via-pad residue", (): void => {
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
  expect(result.initialDrcIssueCount).toBe(156)
  expect(result.repaired).toBeFalse()
  expect(result.finalDrcIssueCount).toBe(6)
  expect(result.publishedDrcIssueCount).toBe(6)
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(budget.maxRegions)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(
    budget.maxCandidateAttempts,
  )
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(
    budget.maxPathSearchNodes,
  )
  expect(routes).toEqual(originalRoutes)
  const validation = drcEvaluator({ traces: [], routes: result.routes })
  const errors = Array.isArray(validation) ? validation : validation.errors
  // These six previously unreported via-pad contacts remain; all moving-
  // copper errors must still be cleared within the original work limits.
  expect(errors).toHaveLength(6)
  expect(
    errors.every((error) => error.type === "pcb_pad_pad_clearance_error"),
  ).toBeTrue()
  expect(errors.map((error) => error.pcb_pad_ids)).toEqual([
    ["via_4", "pcb_smtpad_-25.050_-2.200"],
    ["via_4", "pcb_smtpad_-24.000_-2.200"],
    ["via_45", "pcb_smtpad_-23.400_-4.530"],
    ["via_45", "pcb_smtpad_-23.400_-3.570"],
    ["via_59", "pcb_smtpad_-26.100_-2.200"],
    ["via_59", "pcb_smtpad_-25.050_-2.200"],
  ])
})
