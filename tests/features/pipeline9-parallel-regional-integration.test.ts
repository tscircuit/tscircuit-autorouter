import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { getPipeline9BoundedRepairBudget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded repair dispatches distinct regions and validates the combined result", async (): Promise<void> => {
  const fixture = createBoundedRegionalRepairFixture(2)
  const srj = fixture.originalSrj
  srj.bounds.maxY = 50
  for (const obstacle of srj.obstacles.slice(3)) obstacle.center.y += 39
  for (const point of srj.connections[1]!.pointsToConnect) point.y += 39
  for (const point of fixture.routes[1]!.route) point.y += 39
  const budget = getPipeline9BoundedRepairBudget(2, 2, 1)
  const runtime = new SolverRuntime({
    workerCount: 2,
    workerUrl: new URL("../fixtures/pipeline9ParallelRegional.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    const makeSolver = (): Pipeline9BoundedRegionalRepairSolver => new Pipeline9BoundedRegionalRepairSolver({
      originalSrj: srj,
      routes: fixture.routes,
      syntheticConnectionNames: new Set(),
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      drcEvaluator: fixture.drcEvaluator,
      viaHoleDiameter: 0.15,
      budget,
    })
    const solver = makeSolver()
    await solver.solveAsync(runtime)
    expect(solver.solved).toBe(true)
    expect(solver.stats.parallelRegionalTaskCount).toBeGreaterThanOrEqual(2)
    expect(solver.stats.pathSearchNodeCount).toBeLessThanOrEqual(budget.maxPathSearchNodes)
    expect(solver.stats.candidateAttemptCount).toBeLessThanOrEqual(budget.maxCandidateAttempts)
    const result = fixture.drcEvaluator({ traces: [], routes: solver.getResult().routes })
    expect(Array.isArray(result) ? result : result.errors).toHaveLength(0)

    const paused = makeSolver()
    while (paused.stats.phase !== "select-region" && !paused.solved && !paused.failed) paused.step()
    expect(paused.stats.phase).toBe("select-region")
    const limit = paused.iterations + 10
    await paused.solveAsync(runtime, limit)
    expect(paused.iterations).toBeLessThanOrEqual(limit)
    expect(paused.stats.parallelRegionalTaskCount).toBeGreaterThanOrEqual(2)
    expect(paused.stats.parallelRegionalIncompleteCount).toBeGreaterThan(0)
    await paused.solveAsync(runtime)
    expect(paused.solved).toBe(true)
    const resumed = fixture.drcEvaluator({ traces: [], routes: paused.getResult().routes })
    expect(Array.isArray(resumed) ? resumed : resumed.errors).toHaveLength(0)

    const failing = makeSolver()
    while (failing.stats.phase !== "select-region" && !failing.solved && !failing.failed) failing.step()
    const failedRuntime = { executeAsync: () => Promise.reject(new Error("worker failed")) } as unknown as SolverRuntimeExecutor
    await expect(failing.solveAsync(failedRuntime)).rejects.toThrow("worker failed")
    expect(failing.failed).toBe(true)
  } finally {
    await runtime.dispose()
  }
})
