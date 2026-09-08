import { expect, test } from "bun:test"
import { createSolver, parent } from "./fixtures/planarCostContextSolver"

const measure = <T>(operation: () => T): { result: T; comparisons: number; keys: number } => {
  const originalIs = Object.is
  const originalRound = Math.round
  let comparisons = 0
  let keys = 0
  Object.is = (a: unknown, b: unknown): boolean => {
    comparisons++
    return originalIs(a, b)
  }
  Math.round = (value: number): number => {
    keys++
    return originalRound(value)
  }
  try {
    return { result: operation(), comparisons, keys }
  } finally {
    Object.is = originalIs
    Math.round = originalRound
  }
}

test("accepted planar costs validate once and reuse keys while empty expansions do no cost work", () => {
  const candidate = createSolver(true)
  const reference = createSolver(false)
  candidate.getNeighbors(parent)
  reference.getNeighbors(parent)
  const actual = measure(() => candidate.getNeighbors(parent))
  const expected = measure(() => reference.getNeighbors(parent))
  expect(actual.result).toEqual(expected.result)
  const planarCount = actual.result.filter(node => node.z === parent.z).length
  expect(planarCount).toBeGreaterThan(1)
  // Each unchanged parameter validation performs eight Object.is comparisons;
  // each duplicate grid key calculation performs two rounded coordinate reads.
  expect(expected.comparisons - actual.comparisons).toBe(8 * (planarCount - 1))
  expect(expected.keys - actual.keys).toBe(2 * planarCount)
  expect(actual.comparisons).toBeGreaterThan(0) // First planar cost and via costs.

  for (const solver of [candidate, reference]) {
    for (const node of solver.getNeighbors(parent)) solver.exploredNodes.add(solver.getNodeKey(node))
  }
  const emptyActual = measure(() => candidate.getNeighbors(parent))
  const emptyExpected = measure(() => reference.getNeighbors(parent))
  expect(emptyActual.result).toEqual([])
  expect(emptyActual.result).toEqual(emptyExpected.result)
  expect(emptyActual.comparisons).toBe(0)
  expect(emptyExpected.comparisons).toBe(0)

  for (const solver of [candidate, reference]) solver.B.x = 0.3
  const a = { ...parent, parent: { ...parent, x: -0.1 } }
  const b = structuredClone(a)
  const directActual = measure(() => candidate.setNodeCosts(a))
  const directExpected = measure(() => reference.setNodeCosts(b))
  expect(a).toEqual(b)
  expect(directActual.comparisons).toBe(directExpected.comparisons)
  expect(directActual.keys).toBe(2)
  expect(directActual.keys).toBe(directExpected.keys)
})
