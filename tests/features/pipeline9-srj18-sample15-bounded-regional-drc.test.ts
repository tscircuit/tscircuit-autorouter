import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixture from "../fixtures/pipeline9-stalled-regional-context.json"

// Cropped from SRJ18 sample 15. Fixed points at the smaller region's collar
// block coupled routes. Complete reference DRC also reports the unchanged
// via-pad residue after the safe regional improvements are published.
test("regional repair publishes bounded improvements without hiding via-pad residue", (): void => {
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
      // This cropped repair region omits the rest of each logical net.
      // Validate its copper clearance, not whole-board port connectivity.
      drcOptions: { includeTraceContinuity: false },
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
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    originalSrj,
    routes,
    connMap,
    syntheticConnectionNames: new Set(),
    viaHoleDiameter: 0.15,
    drcEvaluator,
    budget,
  })
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  // Reference DRC now also detects the fixture's 39 via-pad violations.
  expect(result.initialDrcIssueCount).toBe(157)
  expect(result.acceptedRegionCount).toBeGreaterThan(0)
  expect(result.repaired).toBeFalse()
  expect(result.finalDrcIssueCount).toBe(6)
  expect(result.publishedDrcIssueCount).toBe(6)
  expect(result.routes).not.toEqual(originalRoutes)
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(budget.maxRegions)
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(
    budget.maxCandidateAttempts,
  )
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(
    budget.maxPathSearchNodes,
  )
  expect(routes).toEqual(originalRoutes)
  const validation = drcEvaluator({ traces: [], routes: result.routes })
  const remainingErrors = Array.isArray(validation)
    ? validation
    : validation.errors
  expect(remainingErrors).toHaveLength(result.publishedDrcIssueCount)
  expect(
    remainingErrors.every(
      (error) => error.type === "pcb_pad_pad_clearance_error",
    ),
  ).toBeTrue()
})
