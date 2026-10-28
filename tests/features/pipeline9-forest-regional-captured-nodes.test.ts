import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { loadCapturedForestRegion } from "../fixtures/physical-forest-regional/loadCapturedForestRegion"

test("actual SRJ24 forest regions retain native acceptance and use less observed candidate work without adding A13", (): void => {
  const originalGenerate = PortfolioSingleIntraNodeSolver.prototype.generateSolver
  const candidates = new Set<ReturnType<typeof originalGenerate>>()
  PortfolioSingleIntraNodeSolver.prototype.generateSolver = function (parameters) {
    const candidate = originalGenerate.call(this, parameters)
    candidates.add(candidate)
    return candidate
  }
  try {
    for (const [name, legacyObservedWork] of [["cmn_42", 1_043_230], ["cmn_57", 1_187_814]] as const) {
      const input = loadCapturedForestRegion(name)
      candidates.clear()
      const connMap = new ConnectivityMap(input.connectivityNetMap)
      const params = structuredClone(input)
      const solver = new Pipeline9HighDensitySolver({ ...params, connMap, cacheProvider: null,
        useNativeRegionalRouting: true })
      solver.solve()
      expect(solver.failed, solver.error ?? "").toBe(false)
      expect(solver.solved).toBe(true)
      expect(solver.stats.solvedNodeCount).toBe(1)
      expect(solver.stats.promotedFallbackAttemptCount).toBe(1)
      expect(solver.getUpdatedFixedHdRoutes()).toHaveLength(9)
      expect(solver.stats.regionalPreloadedViaCandidateRejectionCount).toBe(0)
      expect(solver.stats.regionalForceImproveCandidateRejectionCount).toBe(0)
      expect(solver.stats.regionalRepairCandidateRejectionCount).toBe(0)
      expect(solver.benchmarkDiagnosticCounters.regionalNativeRouteInstances).toBe(2)
      expect(solver.benchmarkDiagnosticCounters.regionalNativePriorityInstances).toBeGreaterThan(0)
      let candidateWork = 0
      let a13KernelWork = 0
      for (const candidate of candidates) {
        // A Priority DAG's clock already includes its native child calls.
        // Count each generated candidate once, across failed growth attempts.
        candidateWork += candidate.iterations
        if ("routingIterations" in candidate) a13KernelWork += Number(candidate.routingIterations)
      }
      expect(candidateWork).toBeGreaterThan(0)
      expect(candidateWork).toBeLessThanOrEqual(legacyObservedWork)
      expect(a13KernelWork).toBe(0)
    }
  } finally {
    PortfolioSingleIntraNodeSolver.prototype.generateSolver = originalGenerate
  }
})
