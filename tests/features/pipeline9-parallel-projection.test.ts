import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("parallel clearance projection validates merged geometry before publishing", async (): Promise<void> => {
  const fixture = createBoundedRegionalRepairFixture(40)
  const before = structuredClone(fixture.routes)
  const initial = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  const initialErrors = Array.isArray(initial) ? initial : initial.errors
  expect(initialErrors.length).toBeGreaterThan(0)
  const solver = new Pipeline9ClearanceProjectionSolver({
    originalSrj: fixture.originalSrj,
    routes: fixture.routes,
    drcEvaluator: fixture.drcEvaluator,
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
    expect(solver.stats.parallelProjectionAccepted).toBe(false)
    const serial = new Pipeline9ClearanceProjectionSolver({
      originalSrj: fixture.originalSrj,
      routes: fixture.routes,
      drcEvaluator: fixture.drcEvaluator,
    })
    serial.solve()
    expect(solver.getOutput()).toEqual(serial.getOutput())
    expect(solver.iterations).toBe(serial.iterations)
    expect(fixture.routes).toEqual(before)
    const output = solver.getOutput()
    const validation = fixture.drcEvaluator({ traces: [], routes: output })
    const errors = Array.isArray(validation) ? validation : validation.errors
    expect(errors.length).toBeLessThanOrEqual(initialErrors.length)
    for (const [index, route] of output.entries()) {
      expect(route.route[0]).toEqual(before[index]!.route[0])
      expect(route.route.at(-1)).toEqual(before[index]!.route.at(-1))
    }
  } finally {
    await runtime.dispose()
  }
})
