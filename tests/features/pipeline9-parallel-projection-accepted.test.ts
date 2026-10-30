import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("parallel projection publishes a validated improvement", async (): Promise<void> => {
  const fixture = createBoundedRegionalRepairFixture(40)
  fixture.originalSrj.obstacles = []
  fixture.originalSrj.bounds.minX = -24
  fixture.originalSrj.bounds.maxX = 24
  for (const [index, route] of fixture.routes.entries()) {
    for (const point of route.route) {
      point.y = index * 0.15
      if (point.x === -4) point.x = -20
      if (point.x === 4) point.x = 20
    }
  }
  const original = JSON.stringify(fixture.routes)
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => ({
    errors: JSON.stringify(routes ?? hdRoutes) === original
      ? [{ type: "pcb_trace_error", pcb_trace_error_id: "conflict", center: { x: 0, y: 3 } }]
      : [],
  })
  const solver = new Pipeline9ClearanceProjectionSolver({
    originalSrj: fixture.originalSrj,
    routes: fixture.routes,
    drcEvaluator,
    usePrecisionMargin: true,
  })
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL("../fixtures/pipeline9Projection.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    await solver.solveAsync(runtime)
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.stats.parallelProjectionWorkers).toBe(4)
    expect(solver.stats.parallelProjectionAccepted).toBe(true)
    expect(JSON.stringify(solver.getOutput())).not.toBe(original)
    for (const [index, route] of solver.getOutput().entries()) {
      expect(route.route).toHaveLength(fixture.routes[index]!.route.length)
      expect(route.route[0]).toEqual(fixture.routes[index]!.route[0])
      expect(route.route.at(-1)).toEqual(fixture.routes[index]!.route.at(-1))
    }
    expect(JSON.stringify(fixture.routes)).toBe(original)
  } finally {
    await runtime.dispose()
  }
})
