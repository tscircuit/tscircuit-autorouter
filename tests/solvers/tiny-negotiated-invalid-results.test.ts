import { expect, test } from "bun:test"
import { TinyNegotiatedHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyNegotiatedHyperGraphSolver"
import { executeNegotiatedPathingRouteJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyNegotiatedRouteSearch"
import type { NegotiatedPathingRouteResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelNegotiatedPathingTypes"
import type { ParallelStageWorkerJob, ParallelStageWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import { negotiatedPathingFixture } from "../fixtures/negotiated-pathing-fixture"

test("negotiated routing exposes worker and path invariants instead of accepting incomplete routes", async (): Promise<void> => {
  for (const failure of ["worker", "route-id", "status", "endpoint", "incident"] as const) {
    const { topology, problem } = negotiatedPathingFixture()
    const solver = new TinyNegotiatedHyperGraphSolver(topology, problem, { MAX_ITERATIONS: 1000 })
    const pool: ParallelStageWorkerPool = {
      run: async <T>(job: ParallelStageWorkerJob): Promise<T> => {
        if (job.kind !== "pathingNegotiatedRoute") throw new Error("Unexpected test worker job")
        if (failure === "worker") throw new Error("Worker invariant failed")
        const result = executeNegotiatedPathingRouteJob(job)
        if (result.status !== "solved") throw new Error("Expected a solved path before corruption")
        if (failure === "route-id") result.routeId = 999
        if (failure === "status") (result as unknown as { status: string }).status = "unexpected"
        if (failure === "endpoint") result.segments.pop()
        if (failure === "incident") result.segments[0]!.regionId = 999
        return result as unknown as T
      },
    }
    solver.configureWorkerPool(pool)
    await expect(solver.solveAsync()).rejects.toThrow(failure === "worker" ? "Worker invariant" : "Negotiated")
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).not.toBeNull()
    expect(solver.negotiatedStats.committedRoutes).toBe(0)
  }
})
