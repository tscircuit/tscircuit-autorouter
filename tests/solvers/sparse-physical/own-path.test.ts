import { expect, test } from "bun:test"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { sparseOptions } from "./fixtures"

test("same-path drill occupancy survives same-net copper exemptions", (): void => {
  const solver = new SparsePhysicalSingleRouteSolver(sparseOptions)
  const first: Node = { x: 5, y: 5, z: 0, g: 0, h: 0, f: 0, parent: null }
  const via: Node = { ...first, z: 1, parent: first }
  const wire: Node = { ...via, x: 5.2, parent: via }
  const blind = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    allowBlindAndBuriedVias: true,
  })
  expect(blind.isSparseEdgeLegal({ start: via, end: { ...via, z: 2 }, parent: via })).toBe(false)
  expect(solver.isSparseEdgeLegal({ start: wire, end: { ...wire, z: 0 }, parent: wire })).toBe(false)
  expect(solver.isSparseEdgeLegal({ start: { ...wire, x: 5 + 1e-10 }, end: { ...wire, x: 5 + 1e-10, z: 0 }, parent: wire })).toBe(false)
  expect(solver.isSparseEdgeLegal({ start: { ...wire, x: 6 }, end: { ...wire, x: 6, z: 0 }, parent: wire })).toBe(true)
})
