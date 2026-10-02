import { expect, test } from "bun:test"
import { getEveryPossibleOrdering } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/getEveryPossibleOrdering"

type ViaPosition = { x: number; y: number }

test("via permutations preserve candidate order, references and readonly inputs", () => {
  const a: ViaPosition = Object.freeze({ x: 1, y: 2 })
  const b: ViaPosition = Object.freeze({ x: 3, y: 4 })
  const c: ViaPosition = Object.freeze({ x: 5, y: 6 })
  const input: readonly ViaPosition[] = Object.freeze([a, b, c])
  const permutations = getEveryPossibleOrdering(input)

  expect(permutations).toEqual([
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ])
  for (const permutation of permutations) {
    expect(permutation).not.toBe(input)
    expect(permutation.every((point) => input.includes(point))).toBeTrue()
  }
  expect(input).toEqual([a, b, c])
  expect(getEveryPossibleOrdering([])).toEqual([[]])
  expect(getEveryPossibleOrdering([a])).toEqual([[a]])
  expect(getEveryPossibleOrdering([a, a])).toEqual([
    [a, a],
    [a, a],
  ])

  // Reordering a heterogeneous tuple cannot retain its positional tuple type.
  const mixed = [a, "bottom"] as const
  const reordered: (ViaPosition | "bottom")[][] =
    getEveryPossibleOrdering(mixed)
  expect(reordered).toEqual([
    [a, "bottom"],
    ["bottom", a],
  ])
  expect(reordered[1][1]).toBe(a)
})
