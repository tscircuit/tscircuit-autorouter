import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { initTinyHypergraphWasm, loadSerializedHyperGraph, TinyHyperGraphSolver } from "@tscircuit/tiny-hypergraph-wasm"
import { createInput } from "./fixture.mjs"

const { topology, problem, options } = createInput()
assert.throws(() => new TinyHyperGraphSolver(topology, problem), /await initTinyHypergraphWasm/)
assert.throws(() => loadSerializedHyperGraph({ regions: [], ports: [] }), /await initTinyHypergraphWasm/)
await assert.rejects(initTinyHypergraphWasm(new Uint8Array([0])))
assert.throws(() => new TinyHyperGraphSolver(topology, problem), /await initTinyHypergraphWasm/)

const bytes = await readFile(new URL(import.meta.resolve("@tscircuit/tiny-hypergraph-wasm/wasm")))
let resolveSource
const source = new Promise((resolve) => { resolveSource = resolve })
const firstInit = initTinyHypergraphWasm(source)
assert.strictEqual(initTinyHypergraphWasm(bytes), firstInit)
assert.throws(() => new TinyHyperGraphSolver(topology, problem), /await initTinyHypergraphWasm/)
resolveSource(bytes)
await firstInit
assert.strictEqual(initTinyHypergraphWasm(), firstInit)

const solver = new TinyHyperGraphSolver(topology, problem, options)
const independent = new TinyHyperGraphSolver(topology, problem)
try {
  assert.equal(solver.error, null)
  assert.equal(solver.solved, false)
  assert.equal(solver.failed, false)
  assert.equal(solver.iterations, 0)
  assert.equal(solver.pendingRouteCount, 1)
  assert.equal(solver.ripCount, 0)
  assert.equal(solver.getStatus().error, null)
  assert.throws(() => solver.getOutput(), /solved, non-failed/)
  assert.throws(() => solver.stepMany(-1), /maxSteps/)
  assert.equal(solver.failed, false)
  const firstStep = solver.step()
  assert.equal(solver.iterations, firstStep.iterations)
  assert.ok(solver.iterations > 0)
  const final = solver.stepMany(100)
  assert.equal(final.solved, true)
  assert.equal(final.error, null)
  assert.equal(solver.solved, true)
  assert.equal(solver.failed, false)
  assert.equal(solver.pendingRouteCount, 0)
  assert.equal(solver.iterations, final.iterations)
  final.solved = false
  assert.equal(solver.solved, true)
  assert.equal(solver.getStatus().solved, true)
  assert.deepEqual(solver.getRoutingSnapshot().regionSegments, [[], [[0, 0, 1]], []])
  const snapshot = solver.getRoutingSnapshot()
  snapshot.regionSegments.length = 0
  assert.equal(solver.getRoutingSnapshot().regionSegments.length, 3)
  assert.equal(Object.getPrototypeOf(solver.getStats()), Object.prototype)
  assert.equal(solver.getOutput().solvedRoutes.length, 1)
  assert.deepEqual(solver.preview(), solver.visualize())
  assert.equal(independent.iterations, 0)
  assert.equal(independent.solve().solved, true)
  assert.deepEqual(independent.getOutput(), solver.getOutput())
} finally {
  solver.dispose()
  independent.dispose()
}
assert.doesNotThrow(() => solver.dispose())
for (const call of [
  () => solver.step(),
  () => solver.stepMany(1),
  () => solver.solve(),
  () => solver.replaySolution({ solvedRoutePathSegments: [] }),
  () => solver.getStatus(),
  () => solver.getStats(),
  () => solver.getRoutingSnapshot(),
  () => solver.getOutput(),
  () => solver.visualize(),
  () => solver.preview(),
]) {
  assert.throws(call, /disposed/)
}

const limited = new TinyHyperGraphSolver(topology, problem, { ...options, MAX_ITERATIONS: 1 })
try {
  const failed = limited.solve()
  assert.equal(failed.failed, true)
  assert.equal(limited.failed, true)
  assert.equal(limited.solved, false)
  assert.equal(limited.iterations, 1)
  assert.equal(limited.error, "Maximum iterations reached")
} finally {
  limited.dispose()
}
