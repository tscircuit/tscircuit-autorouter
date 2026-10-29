import { expect, test } from "bun:test"
import { CompactA01Frontier } from "lib/solvers/HyperHighDensitySolver/CompactA01Frontier"

test("compact capacity uses the exact owner-dependent integer and Uint32 boundaries", () => {
  for (const owners of [0, 1, 12, 21, 22, 31, 32]) {
    const states = Math.min(2 ** 32, 2 ** (53 - owners))
    expect(CompactA01Frontier.isCapacitySupported(states, owners)).toBe(true)
    expect(CompactA01Frontier.isCapacitySupported(states + 1, owners)).toBe(false)
    const maxMask = 2 ** owners - 1
    const maxKey = maxMask * states + states - 1
    expect(Number.isSafeInteger(maxKey)).toBe(true)
    expect(BigInt(maxKey)).toBe((2n ** BigInt(owners)) * BigInt(states) - 1n)
  }
  expect(CompactA01Frontier.isCapacitySupported(2 ** 21)).toBe(true)
  expect(CompactA01Frontier.isCapacitySupported(2 ** 21 + 1)).toBe(false)
  expect(CompactA01Frontier.isCapacitySupported(4_000_000, 12)).toBe(true)
  for (const owners of [-1, 0.5, 33, NaN, Infinity]) {
    expect(CompactA01Frontier.isCapacitySupported(1, owners)).toBe(false)
  }
  for (const states of [0, -1, 0.5, 2 ** 32 + 1, NaN, Infinity]) {
    expect(CompactA01Frontier.isCapacitySupported(states, 1)).toBe(false)
  }
})
