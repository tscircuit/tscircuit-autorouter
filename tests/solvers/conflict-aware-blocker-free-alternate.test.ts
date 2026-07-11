import { expect, test } from "bun:test"
import { selectConflictOwnerRouteIdsToRip } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/conflict-aware-tiny-hyper-graph-solver"

test("a blocker-free alternate path after strict exhaustion fails loudly", (): void => {
  expect(() =>
    selectConflictOwnerRouteIdsToRip({
      failedRouteId: 0,
      directOwnerRouteIds: [1],
      alternateOwnerRouteIds: [],
    }),
  ).toThrow("found a blocker-free path despite strict candidate exhaustion")
})
