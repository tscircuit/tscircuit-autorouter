import { expect, test } from "bun:test"
import {
  createIntraNodePeerClearanceRoutes,
  createIntraNodePeerClearanceSolver,
} from "../fixtures/createIntraNodePeerClearanceProblem"

test("contracted post-route queries scale both radii without rejecting physically clear copper", (): void => {
  for (const separation of [0.125, 0.1875]) {
    const routes = createIntraNodePeerClearanceRoutes({
      separation,
      peerCopperDiameter: 0.15,
      peerKind: "trace",
    })
    const before = structuredClone(routes)
    const solver = createIntraNodePeerClearanceSolver({ routes, scale: 2 })
    // Full solve-space separation is (.25 + .075) / 2 = .1625.
    // Converting only one side leaves .2 or .2875 and wrongly rejects .1875.
    const conflict = solver["getFirstSolvedViaTraceConflict"]()
    if (separation === 0.125) {
      expect(conflict?.route).toBe(routes[0])
      expect(conflict?.conflictingRoute).toBe(routes[1])
    } else {
      expect(conflict).toBeNull()
    }
    expect(routes).toEqual(before)
  }
})
