import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { createFuturePointCacheStats } from "lib/solvers/HighDensitySolver/futurePointCacheContext"
import { makeFutureCacheNode } from "./fixtures/futurePointCacheSynthetic"

test("normal and PriorityDag owners preserve per-step search costs, witnesses, budgets and accepted routes", () => {
  for (const priority of [false, true]) {
    for (let seed = 0; seed < 4; seed++) {
      const stats = createFuturePointCacheStats()
      const common = { nodeWithPortPoints: makeFutureCacheNode(seed), captureSearchDebug: false, priorityFamilySize: 6, viaDiameter: .25, viaHoleDiameter: .1, minViaHoleEdgeToViaHoleEdgeClearance: .1, traceWidth: .1 }
      const a = priority ? new PriorityDagIntraNodeSolver(common) : new IntraNodeRouteSolver(common)
      const b = priority ? new PriorityDagIntraNodeSolver({ ...common, experimentFuturePointCache: true, futurePointCacheStats: stats }) : new IntraNodeRouteSolver({ ...common, experimentFuturePointCache: true, futurePointCacheStats: stats })
      for (let step = 0; step < 1000 && !a.solved && !a.failed; step++) {
        a.step(); b.step()
        expect(b.iterations).toBe(a.iterations)
        expect(b.MAX_ITERATIONS).toBe(a.MAX_ITERATIONS)
        expect(b.progress).toBe(a.progress)
        expect(b.solved).toBe(a.solved)
        expect(b.failed).toBe(a.failed)
        expect(b.error).toBe(a.error)
        expect(b.solvedRoutes).toEqual(a.solvedRoutes)
        expect(b.activeSubSolver?.iterations).toBe(a.activeSubSolver?.iterations)
        expect(b.activeSubSolver?.MAX_ITERATIONS).toBe(a.activeSubSolver?.MAX_ITERATIONS)
        expect(b.activeSubSolver?.solvedPath).toEqual(a.activeSubSolver?.solvedPath)
        expect(b.activeSubSolver?.candidates).toEqual(a.activeSubSolver?.candidates)
        if (priority) expect((b as PriorityDagIntraNodeSolver).priorityDiagnostics).toEqual((a as PriorityDagIntraNodeSolver).priorityDiagnostics)
      }
      expect(stats.instances).toBeGreaterThan(0)
      expect(stats.lookups).toBeGreaterThan(0)
    }
  }
})
