import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded repair retains projection worker participation after the child completes", async (): Promise<void> => {
  const fixture = createBoundedRegionalRepairFixture(12)
  fixture.originalSrj.obstacles = []
  for (const [index, route] of fixture.routes.entries()) {
    for (const point of route.route) point.y = index * 0.15
  }
  const original = JSON.stringify(fixture.routes)
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => ({
    errors: JSON.stringify(routes ?? hdRoutes) === original
      ? [{ type: "pcb_trace_error", pcb_trace_error_id: "conflict" }]
      : [],
  })
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    drcEvaluator,
  })
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL("../fixtures/pipeline9Projection.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    await solver.solveAsync(runtime)
    expect(solver.solved).toBe(true)
    expect(solver.stats.parallelProjectionWorkerCount).toBeGreaterThanOrEqual(4)
    const evaluatedProposals =
      solver.stats.parallelProjectionAcceptedCount +
      solver.stats.parallelProjectionRejectedCount
    expect(evaluatedProposals).toBeGreaterThan(0)
    expect(evaluatedProposals * 4).toBeLessThanOrEqual(
      solver.stats.parallelProjectionWorkerCount,
    )
  } finally {
    await runtime.dispose()
  }
})
