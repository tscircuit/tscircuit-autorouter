import { expect, test } from "bun:test"
import { initializeTinyHypergraphBindings } from "lib/bindings/initializeTinyHypergraphBindings"
import { TinyHyperGraphSolver } from "../rust/tiny-hypergraph-bindings/ts"
import { createTinyHypergraphInput } from "tests/fixtures/createTinyHypergraphInput"

test("tiny-hypergraph solvers own independent state and reject use after disposal", () => {
  initializeTinyHypergraphBindings()
  initializeTinyHypergraphBindings()
  const { topology, problem, options } = createTinyHypergraphInput()
  const first = new TinyHyperGraphSolver(topology, problem, options)
  const second = new TinyHyperGraphSolver(topology, problem, options)
  try {
    expect(() => first.getOutput()).toThrow(/solved, non-failed/)
    expect(first.solve().solved).toBe(true)
    expect(second.iterations).toBe(0)
    expect(second.solved).toBe(false)

    const snapshot = first.getRoutingSnapshot()
    snapshot.regionSegments.length = 0
    expect(first.getRoutingSnapshot().regionSegments).toEqual([[], [[0, 0, 1]], []])

    first.dispose()
    expect(() => first.dispose()).not.toThrow()
    expect(() => first.step()).toThrow(/disposed/)
    expect(() => first.getStatus()).toThrow(/disposed/)
    expect(() => first.getOutput()).toThrow(/disposed/)
    expect(second.solve().solved).toBe(true)
    expect(second.getOutput().solvedRoutes).toHaveLength(1)
  } finally {
    first.dispose()
    second.dispose()
  }
})
