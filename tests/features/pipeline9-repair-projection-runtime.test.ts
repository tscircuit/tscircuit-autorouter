import { expect, test } from "bun:test"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { preparePipeline9RepairAsync } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9RepairAsync"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { createClearancePreparationFixture } from "../fixtures/createClearancePreparationFixture"

test("nested joint repair uses the shared pool without bypassing outer budgets", async (): Promise<void> => {
  const runtime = createPipeline9TestRuntime(4)
  try {
    const serial = new RelaxTraceClearanceSolver(
      createClearancePreparationFixture(),
    )
    const parallel = new RelaxTraceClearanceSolver(
      createClearancePreparationFixture(),
    )
    const outer = new BaseSolver()
    const inner = new BaseSolver()
    outer.MAX_ITERATIONS = inner.MAX_ITERATIONS = 100_000
    outer.activeSubSolver = inner
    inner.activeSubSolver = parallel
    let dispatched = 0
    const executor = {
      executeAsync: (Solver: any, input: any): any => {
        dispatched++
        return runtime.executeAsync(Solver, input)
      },
    } as SolverRuntimeExecutor
    serial.step()
    parallel.step()
    inner.MAX_ITERATIONS = inner.iterations + 1
    await preparePipeline9RepairAsync(outer, executor, Infinity)
    expect(dispatched).toBe(0)
    inner.MAX_ITERATIONS = 100_000
    await preparePipeline9RepairAsync(outer, executor, 1)
    expect(dispatched).toBe(0)
    await preparePipeline9RepairAsync(outer, executor, Infinity)
    expect(dispatched).toBe(4)
    expect(parallel.iterations).toBe(1)
    for (let step = 0; step < 93; step++) {
      serial.step()
      parallel.step()
    }
    expect(parallel.stats).toEqual(serial.stats)
    serial.solve()
    parallel.solve()
    expect(parallel.getOutput()).toEqual(serial.getOutput())
    expect(parallel.stats).toEqual(serial.stats)
    expect(parallel.iterations).toBe(serial.iterations)
  } finally {
    await runtime.dispose()
  }
})
