import { expect, test } from "bun:test"
import { getTinyHyperGraphSolveGraphOptions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("physical graph work budgets account for every required point pair", (): void => {
  expect(getTinyHyperGraphSolveGraphOptions(1).MAX_ITERATIONS).toBe(2_000_000)
  expect(
    getTinyHyperGraphSolveGraphOptions(1, 0.2032, 200).MAX_ITERATIONS,
  ).toBe(2_000_000)
  expect(
    getTinyHyperGraphSolveGraphOptions(1, 0.2032, 1934).MAX_ITERATIONS,
  ).toBe(19_340_000)
  expect(
    getTinyHyperGraphSolveGraphOptions(0.5, 0.2032, 1934).MAX_ITERATIONS,
  ).toBe(9_670_000)
})
