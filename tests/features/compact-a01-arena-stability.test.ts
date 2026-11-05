import { expect, test } from "bun:test"
import { CompactA01Frontier } from "lib/solvers/HyperHighDensitySolver/CompactA01Frontier"

test("compact typed arenas retain stable heap order, parent paths and capacity across searches", () => {
  const frontier = new CompactA01Frontier(100_000, false)
  for (let index = 0; index < 1_025; index++) {
    frontier.enqueue(index, index / 10, index % 7, index - 1, null)
  }
  const expected = Array.from({ length: 1_025 }, (_, index) => index).sort((a, b) => a % 7 - b % 7 || a - b)
  expect(expected.map(() => frontier.pop())).toEqual(expected)
  const path = frontier.materializePath(1_024, 100, 100)
  expect(path).toHaveLength(1_025)
  expect(path[1_024]).toEqual({ z: 0, row: 10, col: 24, g: 102.4, parentIdx: 1_023, ripped: null })
  const storage = frontier.cells
  frontier.clear()
  frontier.enqueue(22, 1, 1, -1, null)
  expect(frontier.cells).toBe(storage)
  expect(frontier.ripped).toHaveLength(1)
  expect(frontier.pop()).toBe(0)
  expect(() => frontier.pop()).toThrow("empty frontier")
})
