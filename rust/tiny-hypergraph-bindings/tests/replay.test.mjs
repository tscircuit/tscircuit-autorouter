import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { loadTinyHypergraphBindings, loadSerializedHyperGraph, TinyHyperGraphSolver } from "@tscircuit/tiny-hypergraph-bindings"
import { createCrossingGraph } from "./createCrossingGraph.mjs"

test("solution replay restores route order and segment direction without searching", async () => {
  await loadTinyHypergraphBindings(await readFile(new URL(
    import.meta.resolve("@tscircuit/tiny-hypergraph-bindings/wasm"),
  )))
  const { topology, problem } = loadSerializedHyperGraph(createCrossingGraph())
  const solver = new TinyHyperGraphSolver(topology, problem)
  try {
    // Deliberately reverse each segment; replay must start at each route's start port.
    solver.replaySolution({
      solvedRoutePathSegments: [[[1, 0]], [[3, 2]]],
      solvedRoutePathRegionIds: [[4], [4]],
    })
    assert.equal(solver.solved, true)
    assert.equal(solver.failed, false)
    assert.equal(solver.iterations, 0)
    assert.deepEqual(solver.getRoutingSnapshot().regionSegments[4], [[0, 0, 1], [1, 2, 3]])
    assert.deepEqual(solver.getOutput().solvedRoutes.map((route) =>
      route.path.map((hop) => hop.portId),
    ), [["p0", "p1"], ["p2", "p3"]])
    assert.equal(solver.step().iterations, 0)
  } finally {
    solver.dispose()
  }
})
