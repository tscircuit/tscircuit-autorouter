import { expect, test } from "bun:test"
import { GridNodeSet } from "lib/data-structures/GridNodeSet"

test("grid membership preserves Set semantics across bit boundaries and sparse keys", () => {
  const initial = new Set([0, 8, 32, -1, NaN])
  const grid = new GridNodeSet(33, new Set(initial))
  const reference = new Set(initial)
  const keys = [
    ...Array.from({ length: 40 }, (_, index) => index - 2),
    -0,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER,
    2 ** 32,
  ]
  for (const key of keys) expect(grid.has(key)).toBe(reference.has(key))
  for (const key of keys.toReversed()) {
    expect(grid.add(key)).toBe(grid)
    reference.add(key)
    for (const probe of keys) {
      expect(grid.has(probe)).toBe(reference.has(probe))
    }
  }
  expect(() => new GridNodeSet(0)).toThrow()
  expect(() => new GridNodeSet(1.5)).toThrow()
  expect(() => new GridNodeSet(2 ** 32 + 1)).toThrow()
})
