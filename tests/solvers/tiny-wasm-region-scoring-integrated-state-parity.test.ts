import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { ParallelPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { attachOwnedTinyKernelScope } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/createTinyOrderedNeighborKernel"
import { beginTinyNativeSynchronousScope, endTinyNativeSynchronousScope } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/TinyNativeSynchronousScope"

type Host = any
function fixture(): Host {
  const params: Host = structuredClone(input)
  params.flags.USE_SELECTIVE_RERIP_ROUTING = true
  params.graph.ports[0].d.tinyHypergraphPortPenalty = 0.1
  const root: Host = new ParallelPortPointPathingSolver(params)
  while (!root.tinyPipelineSolver.getSolver("solveGraph")) root.step()
  const solver = root.tinyPipelineSolver.getSolver("solveGraph")
  solver.setup()
  solver.regionCostMemo.collectDiagnostics = true
  return { root, solver }
}
function memoState(solver: Host): unknown {
  const result: Host = {}
  for (const [name, value] of Object.entries(solver.regionCostMemo)) {
    if (name === "solver" || name === "nativeCost") continue
    result[name] = ArrayBuffer.isView(value) ? (value as Float64Array).slice() : value && typeof value === "object" ? structuredClone(value) : value
  }
  return result
}
function observe(solver: Host): unknown {
  const { candidateQueue, ...state } = solver.state
  return { state, queue: candidateQueue.toArray(), iterations: solver.iterations,
    cap: solver.MAX_ITERATIONS, solved: solver.solved, failed: solver.failed, error: solver.error,
    stats: solver.stats, selective: solver.getSelectiveReripStats(), scratch: solver.segmentGeometryScratch,
    attempts: solver.routeAttemptCountByRouteId, successes: solver.routeSuccessCountByRouteId,
    best: solver.bestSolvedStateSummary, memo: memoState(solver) }
}

test("integrated scoped region tuples retain every native state prefix, scratch and memo row", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  let scored = 0, copied = 0
  for (const variant of ["empty", "mixed", "singleLayer", "highLayer", "oversized", "unequalColumns"] as const) {
    const left = fixture(), right = fixture(), hosts = [left.solver, right.solver]
    left.solver.wasmNeighborKernel = undefined
    for (const solver of hosts) {
      const count = variant === "empty" ? 0 : variant === "oversized" ? 4097 : 5
      for (let port = 0; port < solver.topology.portCount; port++) solver.topology.portZ[port] = variant === "highLayer" ? port % 2 === 0 ? 31 : 63 : port % 3
      for (let region = 0; region < solver.topology.regionCount; region++) {
        solver.topology.regionAvailableZMask[region] = variant === "singleLayer" ? 1 : variant === "highLayer" ? -1 : 7
        const cache = {
          netIds: Int32Array.from({ length: count }, (_, index) => index % 3 === 0 ? solver.problem.routeNet[0] : 70 + index),
          lesserAngles: Int32Array.from({ length: count }, (_, index) => -17000 + index % 5 * 1000),
          greaterAngles: Int32Array.from({ length: variant === "unequalColumns" ? 1 : count }, (_, index) => 17000 - index % 5 * 1000),
          layerMasks: Int32Array.from({ length: count }, (_, index) => 1 << (index % 3)),
          existingSameLayerIntersections: region % 2, existingCrossingLayerIntersections: region % 3,
          existingEntryExitLayerChanges: region % 4, existingSegmentCount: count, existingRegionCost: 0,
        }
        cache.existingRegionCost = solver.computeRegionCostForRegion(region, cache.existingSameLayerIntersections,
          cache.existingCrossingLayerIntersections, cache.existingEntryExitLayerChanges, count)
        solver.state.regionIntersectionCaches[region] = cache
      }
    }
    const scope = beginTinyNativeSynchronousScope(right.root)!
    expect(scope).toBeDefined()
    attachOwnedTinyKernelScope(right.solver.topology, right.solver.problem, scope)
    const scratchAlias = right.solver.segmentGeometryScratch, rowsAlias = right.solver.regionCostMemo.rows,
      bestAlias = right.solver.state.candidateBestCostByHopId
    try {
      for (let step = 0; step < 100 && !left.solver.solved && !left.solver.failed; step++) {
        left.solver.step(); right.solver.step()
        expect(observe(right.solver)).toEqual(observe(left.solver))
        expect(right.solver.segmentGeometryScratch).toBe(scratchAlias)
        expect(right.solver.regionCostMemo.rows).toBe(rowsAlias)
        expect(right.solver.state.candidateBestCostByHopId).toBe(bestAlias)
      }
      const diagnostics = right.solver.wasmNeighborKernel.diagnostics
      expect(diagnostics.batches).toBeGreaterThan(0)
      // Native rerips can replace the seeded unsupported cache with a fresh
      // eligible one. The original unsupported expansions still use JS.
      if (variant === "oversized" || variant === "unequalColumns") expect(diagnostics.scoringBatches).toBeLessThan(diagnostics.batches)
      else {
        expect(diagnostics.scoringBatches).toBe(diagnostics.batches)
        expect(diagnostics.scoredCandidates).toBeGreaterThan(0)
        scored += diagnostics.scoredCandidates; copied += diagnostics.copiedSegments
      }
    } finally { endTinyNativeSynchronousScope(right.root, scope) }
  }
  expect(scored).toBeGreaterThan(0)
  expect(copied).toBeGreaterThan(0)
})
