import { expect, test } from "bun:test"
import { TinyNegotiatedHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyNegotiatedHyperGraphSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { negotiatedPathingFixture } from "../fixtures/negotiated-pathing-fixture"

test("negotiated workers reschedule cross-net conflicts and commit complete routes in original order", async (): Promise<void> => {
  const { topology, problem } = negotiatedPathingFixture()
  const solver = new TinyNegotiatedHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 1000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    solver.configureWorkerPool(pool)
    await solver.solveAsync()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.state.portAssignment[1]).toBe(10)
    expect(solver.state.portAssignment[4]).toBe(20)
    expect(solver.negotiatedStats.staleRouteConflicts).toBe(1)
    expect(solver.negotiatedStats.speculativeDiscardedExpansions).toBeGreaterThan(0)
    expect(solver.negotiatedStats.routeSearches).toBe(3)
    expect(solver.negotiatedStats.committedRoutes).toBe(2)
    expect(solver.negotiatedStats.searchExpansions).toBeLessThanOrEqual(1000)
    expect(pool.stats.maxActiveWorkers).toBe(2)
    expect(solver.state.unroutedRoutes).toEqual([])
    expect(solver.state.portAssignment[0]).toBe(10)
    expect(solver.state.portAssignment[2]).toBe(10)
    expect(solver.state.portAssignment[3]).toBe(20)
    expect(solver.state.portAssignment[5]).toBe(20)
    expect(solver.state.regionSegments[0]!.map(([routeId]) => routeId)).toEqual([0, 1])
    expect(solver.state.regionSegments[1]!.map(([routeId]) => routeId)).toEqual([0, 1])
  } finally { pool.dispose() }
})
