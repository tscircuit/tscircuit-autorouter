import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { loadTinyHypergraphBindings, loadSerializedHyperGraph, TinyHyperGraphSolver } from "@tscircuit/tiny-hypergraph-bindings"

import { createCrossingGraph } from "./createCrossingGraph.mjs"

test("batched variants restore the same completed solution as solve at the iteration limit", async () => {
  await loadTinyHypergraphBindings(await readFile(new URL(
    import.meta.resolve("@tscircuit/tiny-hypergraph-bindings/wasm"),
  )))
  const { topology, problem } = loadSerializedHyperGraph(createCrossingGraph())
  const options = {
    MAX_ITERATIONS: 8, RIP_THRESHOLD_START: 0, RIP_THRESHOLD_END: 0,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 100, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 0, PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false,
  }
  for (const variant of ["base", "outside-in", "selective-rerip"]) {
    const full = new TinyHyperGraphSolver(topology, problem, options, { variant })
    const batched = new TinyHyperGraphSolver(topology, problem, options, { variant })
    try {
      full.solve()
      batched.stepMany(100)
      assert.equal(full.getStats().acceptedBestSolutionOnTimeout, true, variant)
      assert.equal(batched.solved, true, variant)
      assert.equal(batched.iterations, options.MAX_ITERATIONS, variant)
      assert.deepEqual(batched.getRoutingSnapshot(), full.getRoutingSnapshot(), variant)
      assert.deepEqual(batched.getOutput(), full.getOutput(), variant)
    } finally {
      full.dispose()
      batched.dispose()
    }
  }
})
