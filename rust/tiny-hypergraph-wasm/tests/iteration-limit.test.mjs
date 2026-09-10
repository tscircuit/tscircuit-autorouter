import assert from "node:assert/strict"
import { test } from "node:test"
import { createInput, RustTinyHyperGraphSolver } from "./rawFixture.mjs"

test("batch execution respects the solver iteration limit and preserves failure", () => {
  const { topology, problem, options } = createInput()
  const solver = new RustTinyHyperGraphSolver(topology, problem, { ...options, MAX_ITERATIONS: 1 })
  try {
    const status = solver.stepMany(100)
    assert.equal(status.iterations, 1)
    assert.equal(status.solved, false)
    assert.equal(status.failed, true)
    assert.equal(status.error, "Maximum iterations reached")
    assert.deepEqual(solver.step(), status)
    assert.deepEqual(solver.solve(), status)
    assert.throws(() => solver.getOutput(), /solved, non-failed/)
  } finally {
    solver.free()
  }
})
