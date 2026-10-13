import { expect, test } from "bun:test"
import { getTinyHyperGraphSolveGraphMaxIterations } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("tiny-hypergraph solve budget scales for large decomposed connections", () => {
  expect(
    getTinyHyperGraphSolveGraphMaxIterations({
      effort: 1,
      routeCount: 1_932,
      largestDecomposedConnectionRouteCount: 255,
    }),
  ).toBe(2_000_000)
  expect(
    getTinyHyperGraphSolveGraphMaxIterations({
      effort: 1,
      routeCount: 1_932,
      largestDecomposedConnectionRouteCount: 331,
    }),
  ).toBe(63_307_776)
})
