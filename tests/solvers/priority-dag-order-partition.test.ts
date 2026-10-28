import { expect, test } from "bun:test"
import {
  extendPriorityDag,
  type PriorityDagState,
} from "lib/solvers/HighDensitySolver/priorityDagState"

test("priority pair branches partition all small total orders without asserting routing completeness", () => {
  const permutations = (a: number[]): number[][] =>
    a.length
      ? a.flatMap((v) =>
          permutations(a.filter((x) => x !== v)).map((p) => [v, ...p]),
        )
      : [[]]
  for (let n = 2; n <= 5; n++) {
    const orders = permutations(Array.from({ length: n }, (_, i) => i))
    const empty: PriorityDagState<object> = {
      ancestors: Array.from({ length: n }, () => new Set()),
      witnesses: Array.from({ length: n }, () => ({})),
    }
    const accepts = (s: PriorityDagState<object>, order: number[]): boolean =>
      s.ancestors.every((set, i) =>
        [...set].every((a) => order.indexOf(a) < order.indexOf(i)),
      )
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const x = extendPriorityDag(empty, a, b, () => {}),
          y = extendPriorityDag(empty, b, a, () => {})
        expect(x).not.toBeNull()
        expect(y).not.toBeNull()
        for (const order of orders)
          expect(Number(accepts(x!, order)) + Number(accepts(y!, order))).toBe(
            1,
          )
      }
  }
})
