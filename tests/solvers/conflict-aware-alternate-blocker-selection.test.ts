import { expect, test } from "bun:test"
import { selectConflictOwnerRouteIdsToRip } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/conflict-aware-tiny-hyper-graph-solver"

test("a repeated-owner-avoiding blocker path replaces the direct rip set", (): void => {
  const rippedRouteIds = selectConflictOwnerRouteIdsToRip({
    failedRouteId: 0,
    directOwnerRouteIds: [1, 2],
    alternateOwnerRouteIds: [3],
  })

  expect([...rippedRouteIds]).toEqual([3])
})
