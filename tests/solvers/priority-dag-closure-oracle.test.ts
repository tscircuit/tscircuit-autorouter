import { expect, test } from "bun:test"
import {
  extendPriorityDag,
  type PriorityDagState,
} from "lib/solvers/HighDensitySolver/priorityDagState"

test("priority closure and descendant invalidation agree with an independent matrix oracle", () => {
  let seed = 117,
    work = 0
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  for (let trial = 0; trial < 500; trial++) {
    const n = 2 + (random() % 4)
    const direct = Array.from({ length: n }, () =>
      new Array<boolean>(n).fill(false),
    )
    let state: PriorityDagState<object> = {
      ancestors: Array.from({ length: n }, () => new Set()),
      witnesses: Array.from({ length: n }, () => ({})),
    }
    for (let step = 0; step < 8; step++) {
      const higher = random() % n,
        lower = random() % n
      const expected = direct.map((row) => [...row])
      expected[higher][lower] = true
      for (let k = 0; k < n; k++)
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++)
            expected[i][j] ||= expected[i][k] && expected[k][j]
      const illegal =
        higher === lower ||
        state.ancestors[higher].has(lower) ||
        state.ancestors[lower].has(higher)
      const before = state.ancestors.map((s) => [...s].sort())
      const child = extendPriorityDag(
        state,
        higher,
        lower,
        (_name, count = 1) => {
          work += count
        },
      )
      expect(child === null).toBe(illegal)
      expect(state.ancestors.map((s) => [...s].sort())).toEqual(before)
      if (!child) continue
      direct[higher][lower] = true
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++)
          expect(child.ancestors[i].has(j)).toBe(expected[j][i])
        const changed = child.ancestors[i].size !== state.ancestors[i].size
        expect(child.witnesses[i]).toBe(
          changed ? undefined : state.witnesses[i],
        )
      }
      state = child
    }
  }
  expect(work).toBeGreaterThan(0)
})
