import assert from "node:assert/strict"
import { test } from "node:test"
import { createInput, TinyHyperGraphSolver } from "./solverFixture.mjs"

test("solver inputs, snapshots, and instances have independent ownership", () => {
  const { topology, problem, options } = createInput()
  const first = new TinyHyperGraphSolver(topology, problem, options)
  const second = new TinyHyperGraphSolver(topology, problem, options)
  try {
    topology.portX.fill(99)
    problem.routeNet.fill(99)
    const before = first.getRoutingSnapshot()
    before.portAssignment[0] = 99
    before.unroutedRoutes.length = 0
    assert.deepEqual(first.getRoutingSnapshot().portAssignment, [-1, -1])
    first.solve()
    assert.deepEqual(first.getRoutingSnapshot().portAssignment, [0, 0])
    assert.deepEqual(second.getRoutingSnapshot().portAssignment, [-1, -1])
    assert.equal(second.getStatus().iterations, 0)
    assert.equal(first.getOutput().ports[0].d.x, -1)
    const after = first.getRoutingSnapshot()
    after.regionSegments[1][0][0] = 99
    assert.deepEqual(first.getRoutingSnapshot().regionSegments, [[], [[0, 0, 1]], []])
  } finally {
    first.free()
    second.free()
  }
  assert.throws(() => first.getStatus())

  for (const variant of ["base", "outside-in", "selective-rerip"]) {
    const input = createInput()
    const solver = new TinyHyperGraphSolver(input.topology, input.problem, input.options, { variant })
    const retained = []
    try {
      while (true) {
        const stats = solver.getStats()
        stats.callerMetadata = { untouched: true }
        retained.push([stats, structuredClone(stats)])
        assert.equal(solver.getStats().callerMetadata, undefined, variant)
        const state = solver.getStatus()
        if (state.solved || state.failed) break
        solver.step()
      }
      solver.resetRoutingStateForRerip()
      for (const [snapshot, expected] of retained) assert.deepEqual(snapshot, expected, variant)
    } finally {
      solver.free()
    }
  }
})
