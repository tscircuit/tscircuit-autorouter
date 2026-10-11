import { expect, test } from "bun:test"
import { AutoroutingDrcEngine, GlobalDrcForceImproveSolver, type SimpleRouteJson } from "high-density-repair03/lib"
import { Pipeline9MemoizedGlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9MemoizedGlobalDrcForceImproveSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("memoized global force repair preserves default options, explicit evaluator ownership, geometry and every work counter", (): void => {
  let attempted = 0
  for (const clearance of [undefined, 0.15, 0.25]) {
    for (const ownerTargeting of [false, true]) {
      const fixture = createBoundedRegionalRepairFixture(3)
      fixture.originalSrj.obstacles = fixture.originalSrj.obstacles.map((obstacle, index) => ({
        ...obstacle, connectedTo: [...obstacle.connectedTo, `pcb_smtpad_fixture_${index}`],
      }))
      const srj = { ...fixture.originalSrj, minTraceToPadEdgeClearance: clearance } as SimpleRouteJson
      const params = {
        srj,
        hdRoutes: fixture.routes,
        connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
        effort: 1,
        maxIterations: 4,
        enableTraceViaOwnerTargeting: ownerTargeting,
        enableLargeBoardBroadFallback: false,
        enablePostSolveClearanceRelaxation: false,
      }
      const original = structuredClone(fixture.routes)
      const baseline = new GlobalDrcForceImproveSolver(params)
      const memoized = new Pipeline9MemoizedGlobalDrcForceImproveSolver(params)
      while (!baseline.solved && !baseline.failed) {
        baseline.step()
        memoized.step()
        expect(memoized.stats).toEqual(baseline.stats)
        expect(memoized.solved).toBe(baseline.solved)
        expect(memoized.failed).toBe(baseline.failed)
        expect(memoized.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
      }
      expect(memoized.getSolverName()).toBe(baseline.getSolverName())
      expect(memoized.getOutput()).toEqual(baseline.getOutput())
      expect(memoized.iterations).toBe(baseline.iterations)
      expect(memoized.autoroutingDrcEngine!.lastRunStats).toEqual(baseline.autoroutingDrcEngine!.lastRunStats)
      expect(fixture.routes).toEqual(original)
      expect(memoized.stats.initialDrcIssueCount).toBeGreaterThan(0)
      attempted += memoized.stats.globalDrcForceImproveCandidateAttempts
      const supplied = new AutoroutingDrcEngine(srj)
      const suppliedSolver = new Pipeline9MemoizedGlobalDrcForceImproveSolver({ ...params, autoroutingDrcEngine: supplied })
      expect(suppliedSolver.autoroutingDrcEngine).toBe(supplied)
      const customEvaluator = new Pipeline9MemoizedGlobalDrcForceImproveSolver({ ...params, drcEvaluator: fixture.drcEvaluator })
      expect(customEvaluator.autoroutingDrcEngine).toBeUndefined()
    }
  }
  expect(attempted).toBeGreaterThan(0)
})
