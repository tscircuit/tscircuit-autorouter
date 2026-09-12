import assert from "node:assert/strict"
import { test } from "node:test"
import { createInput, TinyHyperGraphSolver } from "./solverFixture.mjs"

test("single steps, batches, and solve produce the same routed graph", () => {
  const solvers = [1, 100, null].map(() => {
    const { topology, problem, options } = createInput()
    return new TinyHyperGraphSolver(topology, problem, options)
  })
  try {
    for (let i = 0; i < 100 && !solvers[0].getStatus().solved; i++) {
      assert.equal(solvers[0].step().failed, false)
    }
    solvers[1].stepMany(100)
    solvers[2].solve()

    const expectedStatus = solvers[0].getStatus()
    assert.equal(expectedStatus.solved, true)
    assert.equal(expectedStatus.failed, false)
    assert.ok(expectedStatus.iterations > 1)
    assert.equal(expectedStatus.pendingRouteCount, 0)
    assert.deepEqual(solvers[1].getStatus(), expectedStatus)
    assert.deepEqual(solvers[2].getStatus(), expectedStatus)
    assert.deepEqual(solvers[0].getRoutingSnapshot().regionSegments, [[], [[0, 0, 1]], []])

    const output = solvers[0].getOutput()
    assert.deepEqual(solvers[1].getOutput(), output)
    assert.deepEqual(solvers[2].getOutput(), output)
    assert.equal(output.solvedRoutes.length, 1)
    assert.deepEqual(output.solvedRoutes[0].path.map((hop) => hop.portId), ["p0", "p1"])
    assert.deepEqual(output.ports[0].d.customMetadata, { name: "retained" })
    assert.equal(Object.getPrototypeOf(output), Object.prototype)
    assert.equal(Object.getPrototypeOf(solvers[0].getStats()), Object.prototype)
    assert.ok(solvers[0].visualize().lines.length > 0)
    assert.deepEqual(solvers[0].stepMany(100), expectedStatus)
  } finally {
    for (const solver of solvers) solver.free()
  }
})
