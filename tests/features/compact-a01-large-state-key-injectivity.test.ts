import { expect, test } from "bun:test"
import { CompactA01Frontier, type CompactA01RippedConnection } from "lib/solvers/HyperHighDensitySolver/CompactA01Frontier"

test("large grids with few owners retain exact distinct keys through MAX_SAFE_INTEGER", () => {
  let seed = 0x51a42b93
  for (const owners of [0, 1, 12, 21, 22, 31, 32]) {
    const states = Math.min(2 ** 32, 2 ** (53 - owners))
    const keys = new Map<number, bigint>()
    for (let sample = 0; sample < 128; sample++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const mask = sample === 0 ? 2 ** owners - 1 : seed % 2 ** owners
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const cell = sample < 2 ? states - 1 - sample : seed % states
      const key = mask * states + cell
      const exact = BigInt(mask) * BigInt(states) + BigInt(cell)
      expect(Number.isSafeInteger(key)).toBe(true)
      expect(BigInt(key)).toBe(exact)
      const previous = keys.get(key)
      if (previous !== undefined) expect(previous).toBe(exact)
      keys.set(key, exact)
    }
  }
  let allOwners: CompactA01RippedConnection | null = null
  for (let id = 0; id < 32; id++) allOwners = { id, prev: allOwners }
  const highBoundary = new CompactA01Frontier(2 ** 21, true, 32)
  highBoundary.enqueue(2 ** 21 - 1, 1, 1, -1, allOwners)
  highBoundary.enqueue(2 ** 21 - 2, 1, 1, -1, allOwners)
  highBoundary.enqueue(2 ** 21 - 1, 2, 2, -1, allOwners)
  expect(highBoundary.size).toBe(2)
  expect(highBoundary.metrics.prunedEquivalent).toBe(1)
  expect(allOwners!.compactMask).toBe(0xffffffff)
  const wideGrid = new CompactA01Frontier(2 ** 32, true, 12)
  wideGrid.enqueue(2 ** 32 - 1, 1, 1, -1, { id: 11, prev: null })
  wideGrid.enqueue(0, 1, 1, -1, { id: 11, prev: null })
  expect(wideGrid.size).toBe(2)
  expect(wideGrid.cells[0]).toBe(2 ** 32 - 1)
  expect(wideGrid.cells[1]).toBe(0)
})
