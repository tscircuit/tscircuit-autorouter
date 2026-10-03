import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"
test("same-looking foreign owner never exempts copper and unreachable solve returns no partial board", () => {
  const p = teeProblem()
  p.terminals = p.terminals.slice(0, 2)
  p.copper.push({
    id: "foreign-wall",
    owner: "N_mst0",
    kind: "pad",
    layers: [0, 1],
    start: { x: 5, y: 6.5 },
    end: { x: 5, y: 6.5 },
    radius: 0,
    rectangle: { width: 2, height: 19, rotation: 0 },
  })
  const result = routeDynamicNetTree(p, options)
  expect(result.solved).toBe(false)
  expect(result.error).toContain("No physically reachable")
  expect(result.traces).toEqual([])
  expect(result.attachments).toEqual([])
})
