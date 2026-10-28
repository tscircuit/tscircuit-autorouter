import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { CertifiedDirectAutoroutingPipelineSolver } from "lib/testing/CertifiedDirectAutoroutingPipelineSolver"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("a selected general solver's asynchronous failure remains visible with the original runtime and state", async () => {
  const solver = new CertifiedDirectAutoroutingPipelineSolver(getCertifiedDirectTestInput(), { targetMinCapacity: 0.5 })
  const inner = solver.pipeline9!
  const originalError = new Error("original worker failure")
  const runtime = {} as SolverRuntimeExecutor
  let observedRuntime: SolverRuntimeExecutor | undefined
  inner.solveAsync = async (supplied): Promise<void> => {
    observedRuntime = supplied
    inner.failed = true
    inner.error = originalError.message
    inner.iterations = 7
    inner.timeToSolve = 11
    throw originalError
  }
  await expect(solver.solveAsync(runtime)).rejects.toBe(originalError)
  expect(observedRuntime).toBe(runtime)
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe(inner.error)
  expect(solver.iterations).toBe(inner.iterations)
  expect(solver.timeToSolve).toBe(inner.timeToSolve)
  expect(solver.selectedStrategy).toBe("pipeline9")
})
