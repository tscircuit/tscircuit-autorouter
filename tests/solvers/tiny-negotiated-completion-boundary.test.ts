import { expect, test } from "bun:test"
import { TinyNegotiatedHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyNegotiatedHyperGraphSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { negotiatedPathingFixture } from "../fixtures/negotiated-pathing-fixture"

test("negotiated completion awaits the original cost-aware candidate at a one-expansion boundary", async (): Promise<void> => {
  const { topology, problem } = negotiatedPathingFixture()
  const solver = new TinyNegotiatedHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 1, RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    solver.configureWorkerPool(pool)
    solver.step()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(false)
    expect(solver.pendingEffects).toHaveLength(1)
    await Promise.all(solver.pendingEffects.map((effect) => effect.promise))
    expect(solver.failed).toBe(false)
    await solver.solveAsync()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.MAX_ITERATIONS).toBe(1)
    expect(solver.negotiatedStats.searchExpansions).toBe(1)
    expect(solver.negotiatedStats.completionSearchExpansions).toBeGreaterThan(1)
    expect(solver.negotiatedStats.completionSearchExpansions).toBeLessThanOrEqual(50_000)
    expect(solver.stats.finalRoutingStrategy).toBe("congestion-aware")
    expect(solver.stats.greedyFinalRouteMaxIterations).toBe(50_000)
    expect(solver.state.unroutedRoutes).toEqual([])
    expect(solver.state.regionSegments[0]!.map(([routeId]) => routeId)).toEqual([0, 1])
  } finally { pool.dispose() }
})
