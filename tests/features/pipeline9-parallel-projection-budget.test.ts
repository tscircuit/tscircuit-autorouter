import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("parallel projection respects a partial iteration budget", async (): Promise<void> => {
  const fixture = createBoundedRegionalRepairFixture(40)
  const params = {
    originalSrj: fixture.originalSrj,
    routes: fixture.routes,
    drcEvaluator: fixture.drcEvaluator,
  }
  const serial = new Pipeline9ClearanceProjectionSolver(params)
  const parallel = new Pipeline9ClearanceProjectionSolver(params)
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL("../fixtures/pipeline9Projection.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    serial.step()
    serial.step()
    await parallel.solveAsync(runtime, 2)
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.solved).toBe(serial.solved)
    expect(parallel.failed).toBe(serial.failed)
    expect(parallel.activeSubSolver?.iterations).toBe(serial.activeSubSolver?.iterations)
    serial.solve()
    await parallel.solveAsync(runtime)
    expect(parallel.getOutput()).toEqual(serial.getOutput())
    expect(parallel.iterations).toBe(serial.iterations)
  } finally {
    await runtime.dispose()
  }
})
