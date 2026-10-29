import { expect, test } from "bun:test"
import { AutoroutingDrcEngine, GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import type { SimplifiedPcbTraces } from "high-density-repair03/lib/types"
import { getDrcSnapshot, getTopologyRepairDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { RELAXED_DRC_OPTIONS } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import { GlobalDeltaDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/GlobalDeltaDrcEngine"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "./fixtures/pipeline9-bounded-regional-repair-fixture"

class RecordingNativeEngine extends AutoroutingDrcEngine {
  readonly candidates: SimplifiedPcbTraces[] = []

  override evaluate(traces: SimplifiedPcbTraces): ReturnType<AutoroutingDrcEngine["evaluate"]> {
    this.candidates.push(structuredClone(traces))
    return super.evaluate(traces)
  }
}

class RecordingDeltaEngine extends GlobalDeltaDrcEngine {
  readonly candidates: SimplifiedPcbTraces[] = []

  override evaluate(traces: SimplifiedPcbTraces): ReturnType<GlobalDeltaDrcEngine["evaluate"]> {
    this.candidates.push(structuredClone(traces))
    return super.evaluate(traces)
  }
}

test("native snapshot policies and candidate acceptance remain exact through multi-route transactions", () => {
  const fixture = createBoundedRegionalRepairFixture(3)
  const srj = { ...fixture.originalSrj, traces: [] }
  srj.minTraceToPadEdgeClearance = 0.12
  for (const obstacle of srj.obstacles) {
    obstacle.connectedTo.push(`pcb_smtpad_${obstacle.circuitJsonMetadata!.pcb_smtpad_id}`)
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const options = {
    connMap,
    traceClearance: srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.traceClearance,
    viaClearance: srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.viaClearance,
    includeTraceViaOwnerMetadata: false,
  }
  const native = new AutoroutingDrcEngine(srj, options)
  const delta = new GlobalDeltaDrcEngine(srj, options)
  const candidates = [structuredClone(fixture.routes)]
  const detour = structuredClone(fixture.routes)
  detour[0]!.route.splice(1, 1, { x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 })
  candidates.push(detour)
  const viaCandidate = structuredClone(detour)
  viaCandidate[1]!.route = [{ x: -4, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }, { x: -1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }]
  viaCandidate[1]!.vias = [{ x: -1, y: 1 }, { x: 1, y: 1 }]
  candidates.push(viaCandidate)
  const regional = structuredClone(viaCandidate)
  regional[0]!.route[1]!.y -= 0.15
  regional[1]!.route[2]!.x -= 0.15
  regional[1]!.route[1]!.x -= 0.15
  regional[1]!.vias[0]!.x -= 0.15
  candidates.push(regional, structuredClone(viaCandidate), [...regional].reverse(), structuredClone(fixture.routes))
  for (const candidate of candidates) {
    // Exercise both native projection policies, including centers, score,
    // first/worst metadata, trace-to-route maps and via target identities.
    for (const snapshot of [getDrcSnapshot, getTopologyRepairDrcSnapshot]) {
      expect(snapshot(srj, candidate, undefined, connMap, delta)).toEqual(snapshot(srj, candidate, undefined, connMap, native))
    }
  }
  expect(delta.globalStats.deltaDrcCalls).toBe(candidates.length * 2)
  expect(delta.globalStats.deltaDrcTouchedQueries).toBeGreaterThan(0)
  expect(delta.globalStats.deltaDrcReusedQueries).toBeGreaterThan(0)

  const solverNative = new RecordingNativeEngine(srj, options)
  const solverDelta = new RecordingDeltaEngine(srj, options)
  const params = {
    srj, hdRoutes: fixture.routes, connMap, effort: 1, maxIterations: 4,
    enableLargeBoardBroadFallback: false, enablePostSolveClearanceRelaxation: false,
    referenceDrcEvaluator: fixture.drcEvaluator,
  }
  const full = new GlobalDrcForceImproveSolver({ ...params, autoroutingDrcEngine: solverNative })
  const incremental = new GlobalDrcForceImproveSolver({ ...params, autoroutingDrcEngine: solverDelta })
  full.solve()
  incremental.solve()
  expect(incremental.getOutput()).toEqual(full.getOutput())
  expect(incremental.solved).toBe(full.solved)
  expect(incremental.failed).toBe(full.failed)
  expect(incremental.iterations).toBe(full.iterations)
  const stableStats = (stats: typeof full.stats): Record<string, unknown> => Object.fromEntries(Object.entries(stats).filter(([key]) => !key.toLowerCase().includes("timems")))
  expect(stableStats(incremental.stats)).toEqual(stableStats(full.stats))
  expect(solverDelta.candidates).toEqual(solverNative.candidates)
  expect(solverDelta.globalStats.deltaDrcCalls).toBeGreaterThan(2)
  expect(solverDelta.globalStats.deltaDrcReusedQueries).toBeGreaterThan(0)
  expect(incremental.referenceDrcEvaluator).toBe(fixture.drcEvaluator)
  const reference = fixture.drcEvaluator({ routes: incremental.getOutput(), traces: [] })
  const originalReference = fixture.drcEvaluator({ routes: full.getOutput(), traces: [] })
  expect(reference).toEqual(originalReference)
})
