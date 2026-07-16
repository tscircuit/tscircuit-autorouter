import { expect, test } from "bun:test"
import { getDuplicateCongestedPortSolveOptions } from "../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("duplicate-port preprocessing saturates after normal effort", () => {
  const lowEffort = getDuplicateCongestedPortSolveOptions(0.1)
  const normalEffort = getDuplicateCongestedPortSolveOptions(1)
  const maxEffort = getDuplicateCongestedPortSolveOptions(100)

  expect(lowEffort.MAX_ITERATIONS).toBe(200_000)
  expect(normalEffort.MAX_ITERATIONS).toBe(2_000_000)
  expect(maxEffort.MAX_ITERATIONS).toBe(normalEffort.MAX_ITERATIONS)
})
