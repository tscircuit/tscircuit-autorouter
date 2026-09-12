import assert from "node:assert/strict"
import { test } from "node:test"
import { createInput, TinyHyperGraphSolver } from "./solverFixture.mjs"

test("invalid inputs and premature output requests throw JavaScript errors", () => {
  const { topology, problem, options } = createInput()
  assert.throws(() => new TinyHyperGraphSolver({}, problem, options), /Invalid topology/)
  assert.throws(() => new TinyHyperGraphSolver(topology, {}, options), /Invalid problem/)
  assert.throws(() => new TinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: "bad" }), /Invalid solver options/)
  const solver = new TinyHyperGraphSolver(topology, problem, options)
  try {
    assert.throws(() => solver.getOutput(), /solved, non-failed/)
    for (const count of [0, -1, 0.5, NaN, Infinity, 2 ** 32]) {
      assert.throws(() => solver.stepMany(count), /maxSteps/)
    }
    assert.equal(solver.getStatus().iterations, 0)
    assert.equal(solver.solve().solved, true)
  } finally {
    solver.free()
  }
})
