import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("MST rejects invalid coordinates, ambiguous references, and foreign extra-edge data", () => {
  const first = { x: 0, y: 0 }
  const second = { x: 1, y: 0 }
  expect(() => buildMinimumSpanningTree([{ x: NaN, y: 0 }])).toThrow("non-finite coordinates")
  expect(() => buildMinimumSpanningTree([first, { x: 1, y: Infinity }])).toThrow("non-finite coordinates")
  expect(() => buildMinimumSpanningTree([first, first])).toThrow("repeats an input point reference")
  expect(() => buildMinimumSpanningTree([first, second], {
    extraEdges: [{ from: { ...first }, to: second, weight: 0 }],
  })).toThrow("not an input point reference")
  expect(() => buildMinimumSpanningTree([first, second], {
    extraEdges: [{ from: first, to: second, weight: NaN }],
  })).toThrow("non-finite weight")
  expect(() => buildMinimumSpanningTree([
    { x: -Number.MAX_VALUE, y: 0 },
    { x: Number.MAX_VALUE, y: 0 },
  ])).toThrow("non-finite")
  expect(buildMinimumSpanningTree([])).toEqual([])
  expect(buildMinimumSpanningTree([first])).toEqual([])
})
