import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import nodeJson from "../fixtures/srj18-sample15-sub-via-node.json"

test("grow/shrink releases failed searches when debug capture is disabled", (): void => {
  const previousCache = globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE
  const results: GrowShrinkHighDensityIntraNodeSolver[] = []
  try {
    for (const captureSearchDebug of [false, true, undefined]) {
      globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = new InMemoryCache()
      const solver = new GrowShrinkHighDensityIntraNodeSolver({
        nodeWithPortPoints: structuredClone(nodeJson) as NodeWithPortPoints,
        viaDiameter: 0.3,
        traceWidth: 0.1,
        obstacleMargin: 0.15,
        effort: 1,
        layerCount: 4,
        fallbackToInvalidGeometryOnFailure: false,
        captureSearchDebug,
      })
      solver.solve()
      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      expect(solver.growthAttempts).toBeGreaterThan(0)
      if (captureSearchDebug === false) {
        expect(solver.failedSolvers).toHaveLength(0)
      } else {
        expect(solver.failedSolvers.length).toBeGreaterThan(0)
      }
      results.push(solver)
    }
    for (const solver of results.slice(1)) {
      expect(solver.solvedRoutes).toEqual(results[0]!.solvedRoutes)
      expect(solver.iterations).toBe(results[0]!.iterations)
      expect(solver.growthAttempts).toBe(results[0]!.growthAttempts)
      expect(solver.stats).toEqual(results[0]!.stats)
      expect(solver.error).toBe(results[0]!.error)
    }
  } finally {
    globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = previousCache
  }
})
