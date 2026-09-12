import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { loadTinyHypergraphBindings, TinyHyperGraphSolver } from "@tscircuit/tiny-hypergraph-bindings"
import { createInput } from "./fixture.mjs"

test("typed JSON transport preserves typed arrays, special numbers and metadata semantics", async () => {
  await loadTinyHypergraphBindings(await readFile(new URL(
    import.meta.resolve("@tscircuit/tiny-hypergraph-bindings/wasm"),
  )))
  const { topology, problem, options } = createInput()
  topology.portY[0] = -0
  topology.portMetadata[0].custom = {
    null: null,
    undefined: undefined,
    numbers: [NaN, Infinity, -Infinity, -0],
    bigints: [0n, 42n, 9007199254740991n],
    largeNumbers: [1e16, 1e30],
    unicode: "x\ud800",
    map: new Map([["present", undefined], ["zero", -0]]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    ...options, RIP_THRESHOLD_START: Infinity, DISTANCE_TO_COST: -0,
  })
  try {
    assert.equal(solver.solve().solved, true)
    const output = solver.getOutput()
    assert.equal(Object.is(output.ports[0].d.y, -0), true)
    assert.deepEqual(output.ports[0].d.custom, {
      null: undefined,
      undefined: undefined,
      numbers: [undefined, undefined, undefined, 0],
      bigints: [0, 42, 9007199254740991],
      largeNumbers: [1e16, 1e30],
      unicode: "x\ufffd",
      map: { present: undefined, zero: 0 },
    })
    assert.deepEqual(Object.keys(output.ports[0].d.custom), ["null", "undefined", "numbers", "bigints", "largeNumbers", "unicode", "map"])
    assert.equal(solver.getRoutingSnapshot().currentRouteId, undefined)
    assert.equal(topology.portMetadata[0].custom.null, null)
    assert.equal(Number.isNaN(topology.portMetadata[0].custom.numbers[0]), true)
    assert.equal(topology.portMetadata[0].custom.unicode, "x\ud800")
  } finally {
    solver.dispose()
  }
})
