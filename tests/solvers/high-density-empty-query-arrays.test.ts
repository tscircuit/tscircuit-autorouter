import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import {
  createEmptyQueryPredicateCase,
  emptyQueryPredicateCases,
  type PredicateObservation,
} from "tests/fixtures/createEmptyQueryPredicateCase"
import golden from "tests/fixtures/empty-query-predicate-golden.json"

test("empty query fallback preserves original search and getter order", (): void => {
  const observations: PredicateObservation[] = emptyQueryPredicateCases.map(
    (name) => createEmptyQueryPredicateCase(SingleHighDensityRouteSolver, name),
  )
  expect(observations).toEqual(golden.observations)
})
