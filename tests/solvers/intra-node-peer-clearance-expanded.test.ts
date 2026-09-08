import { expect, test } from "bun:test"
import {
  createIntraNodePeerClearanceRoutes,
  createIntraNodePeerClearanceSolver,
} from "../fixtures/createIntraNodePeerClearanceProblem"

test("expanded post-route queries scale both indexed copper and the query margin across buckets", (): void => {
  for (const peerKind of ["trace", "via"] as const) {
    for (const separation of [3.5, 4]) {
      const routes = createIntraNodePeerClearanceRoutes({
        separation,
        peerCopperDiameter: 1.5,
        peerKind,
      })
      const before = structuredClone(routes)
      const solver = createIntraNodePeerClearanceSolver({
        routes,
        scale: 0.25,
      })
      // The query lies in bucket 0 and the peer in bucket 3 or 4. Full
      // separation is (.3 / 2 + .1 + 1.5 / 2) / .25 = 4. Scaling only
      // the query gives 1.75; scaling only indexed copper gives 3.25.
      const conflict = solver["getFirstSolvedViaTraceConflict"]()
      if (separation === 3.5) {
        expect(conflict?.route).toBe(routes[0])
        expect(conflict?.via).toBe(routes[0]!.vias[0])
        expect(conflict?.conflictingRoute).toBe(routes[1])
      } else {
        expect(conflict).toBeNull()
      }
      expect(routes).toEqual(before)
    }
  }
})
