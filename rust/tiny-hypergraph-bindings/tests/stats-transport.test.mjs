import assert from "node:assert/strict"
import { test } from "node:test"
import { TinyHyperGraphSolver, createInput } from "./solverFixture.mjs"
import { decodeStatsSnapshot } from "../dist/decodeStatsSnapshot.js"

test("JSON stats preserve values, own keys and independent snapshots through every variant", () => {
  const { topology, problem, options } = createInput()
  for (const variant of ["base", "outside-in", "selective-rerip"]) {
    const solver = new TinyHyperGraphSolver(topology, problem, options, { variant })
    const retained = []
    try {
      while (true) {
        const stats = solver.getStats()
        const parsed = decodeStatsSnapshot(solver.getStatsJson())
        assert.deepEqual(parsed, stats, variant)
        assert.deepEqual(Object.keys(parsed), Object.keys(stats), variant)
        parsed.callerMetadata = { untouched: true }
        retained.push([parsed, structuredClone(parsed)])
        assert.equal(solver.getStats().callerMetadata, undefined)
        const state = solver.getStatus()
        if (state.solved || state.failed) break
        solver.step()
      }
      for (const [snapshot, expected] of retained) assert.deepEqual(snapshot, expected)
      solver.resetRoutingStateForRerip()
      assert.deepEqual(decodeStatsSnapshot(solver.getStatsJson()), solver.getStats())
    } finally {
      solver.free()
    }
  }
})
