import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"
test("terminal identities are exact and never connected by prefix or duplicate ID", () => {
  const p = teeProblem()
  p.terminals[1]!.id = "A:0"
  const fixed = routeDynamicNetTree(p, { ...options })
  expect(fixed.solved).toBe(true)
  expect(fixed.stats.searches).toBe(2)
  expect(fixed.stats.finalComponents).toBe(1)
  p.terminals[1]!.id = "A"
  expect(() => routeDynamicNetTree(p, options)).toThrow(
    "Duplicate terminal identity",
  )
})
