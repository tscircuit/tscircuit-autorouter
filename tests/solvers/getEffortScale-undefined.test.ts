import { expect, test } from "bun:test"
import { getEffortScale } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

// Regression: effort is optional and reaches getEffortScale as `undefined` on
// low-connection boards (the DuplicateCongestedPortSolver prepass passes
// params.effort straight through). `Math.max(undefined, 1e-2)` is NaN, which
// makes every `MAX_ITERATIONS = N * getEffortScale(effort)` NaN and the solver
// reports "ran out of iterations" on the first step. getEffortScale must return
// a finite, positive scale for undefined/NaN input.
test("getEffortScale returns a finite positive scale for undefined effort", () => {
  const scale = getEffortScale(undefined as unknown as number)
  expect(Number.isFinite(scale)).toBe(true)
  expect(scale).toBeGreaterThan(0)
  expect(Number.isFinite(2_000_000 * scale)).toBe(true)
})

test("getEffortScale still honors an explicit effort", () => {
  expect(getEffortScale(3)).toBe(3)
  expect(getEffortScale(0.001)).toBe(1e-2)
})
