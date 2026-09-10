import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile } from "node:fs/promises"
import { initTinyHypergraphWasm, TinyHyperGraphSolver } from "@tscircuit/tiny-hypergraph-wasm"
import { createInput } from "./fixture.mjs"

test("solver variants agree across batched and full solves and reject unknown variants", async () => {
  await initTinyHypergraphWasm(await readFile(new URL(
    import.meta.resolve("@tscircuit/tiny-hypergraph-wasm/wasm"),
  )))
  const { topology, problem, options } = createInput()
  for (const variant of ["base", "outside-in", "selective-rerip"]) {
    const configuration = { variant, preserveInitialAssignments: true }
    const batched = new TinyHyperGraphSolver(topology, problem, options, configuration)
    const full = new TinyHyperGraphSolver(topology, problem, options, configuration)
    try {
      while (!batched.solved && !batched.failed) batched.stepMany(2)
      assert.equal(batched.solved, true, variant)
      assert.equal(full.solve().solved, true, variant)
      assert.deepEqual(batched.getOutput(), full.getOutput(), variant)
      assert.equal(batched.iterations, full.iterations, variant)
    } finally {
      batched.dispose()
      full.dispose()
    }
  }
  assert.throws(() => new TinyHyperGraphSolver(topology, problem, options, {
    variant: "unknown",
  }), /Invalid solver configuration/)
})
