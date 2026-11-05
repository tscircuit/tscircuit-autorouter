import { expect, test } from "bun:test"
import { CompactA01Frontier } from "lib/solvers/HyperHighDensitySolver/CompactA01Frontier"

test("compact frontier separates exact victim IDs including bit 31 and resets state between searches", () => {
  const frontier = new CompactA01Frontier(2 ** 21 - 1, true)
  const low = { id: 0, prev: null }
  const high = { id: 31, prev: null }
  const both = { id: 31, prev: low }
  const reversed = { id: 0, prev: high }
  frontier.enqueue(100, 1, 1, -1, null)
  frontier.enqueue(100, 2, 2, -1, low)
  frontier.enqueue(100, 3, 3, -1, high)
  frontier.enqueue(100, 4, 4, -1, both)
  frontier.enqueue(100, 5, 5, -1, reversed)
  expect(frontier.size).toBe(4)
  expect(frontier.metrics.prunedEquivalent).toBe(1)
  expect([frontier.pop(), frontier.pop(), frontier.pop(), frontier.pop()]).toEqual([0, 1, 2, 3])
  expect(frontier.ripped[3]).toBe(both)
  frontier.clear()
  frontier.enqueue(100, 10, 10, -1, reversed)
  expect(frontier.size).toBe(1)
  expect(frontier.labelCount).toBe(1)
  expect(() => frontier.enqueue(100, 1, 1, -1, { id: 32, prev: null })).toThrow("victim ID")
})
