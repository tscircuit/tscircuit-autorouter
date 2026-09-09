import { expect, test } from "bun:test"
import {
  createIntraNodePeerClearanceRoutes,
  createIntraNodePeerClearanceSolver,
} from "../fixtures/createIntraNodePeerClearanceProblem"

test("post-route scale views preserve original route identity, metadata, and legacy clearance", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    for (const physicalSeparation of [0.3125, 0.5]) {
      const routes = createIntraNodePeerClearanceRoutes({
        separation: physicalSeparation / (scale ?? 1),
        peerCopperDiameter: 0.15,
        peerKind: "trace",
      })
      const before = structuredClone(routes)
      const solver = createIntraNodePeerClearanceSolver({ routes, scale })
      const conflict = solver["getFirstSolvedViaTraceConflict"]()
      if (physicalSeparation === 0.3125) {
        expect(conflict?.route).toBe(routes[0])
        expect(conflict?.via).toBe(routes[0]!.vias[0])
        expect(conflict?.conflictingRoute).toBe(routes[1])
        expect(conflict?.conflictingRoute.route).toBe(routes[1]!.route)
        expect(conflict?.conflictingRoute.vias).toBe(routes[1]!.vias)
      } else {
        expect(conflict).toBeNull()
      }
      expect(solver.solvedRoutes).toBe(routes)
      expect(routes).toEqual(before)
      expect(routes[0]!.traceThickness).toBe(0.15)
      expect(routes[0]!.viaDiameter).toBe(0.3)
      expect(routes[1]!.route[0]!.traceThickness).toBe(0.15)
    }
  }
})
