import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { dataset } from "dataset-srj18"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixture from "../fixtures/pipeline9-stalled-regional-context.json"

// Cropped from SRJ18 sample 15, antmicro/sdi-fiber-adapter. Preserve its
// physical outline: the crop bounds are cut points, not physical board edges.
// Source: dataset-srj18#100e8957, samples/sample015.json.
// Fixed points at the smaller region's collar
// block coupled routes; retrying that context spends the remaining search work.
test("regional repair expands a stalled context before exhausting its shared budget", (): void => {
  const originalSrj = fixture.originalSrj as SimpleRouteJson
  const sample015 = dataset.sample015 as SimpleRouteJson
  expect(
    createHash("sha256").update(JSON.stringify(sample015)).digest("hex"),
  ).toBe("0abc1ca078a8f23f884f409174ee7068810b9663672373d9609adf520c514be1")
  expect(originalSrj.outline).toEqual(sample015.outline)
  expect(originalSrj.obstacles).toHaveLength(167)
  for (const obstacle of originalSrj.obstacles) {
    expect(
      sample015.obstacles.some(
        (source) =>
          source.center.x === obstacle.center.x &&
          source.center.y === obstacle.center.y &&
          source.width === obstacle.width &&
          source.height === obstacle.height,
      ),
    ).toBeTrue()
  }
  const routes = structuredClone(fixture.routes) as HighDensityRoute[]
  expect(routes).toHaveLength(148)
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
  // Include the 39 existing via-pad clearances alongside the previous 118 issues.
  expect(result.initialDrcIssueCount).toBe(157)
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
