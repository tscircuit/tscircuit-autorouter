import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  createIntraNodePeerClearanceRoutes,
  createIntraNodePeerClearanceSolver,
} from "../fixtures/createIntraNodePeerClearanceProblem"

test("scaled post-route clearance preserves same-net sharing without exempting a foreign peer", (): void => {
  const connectedRoutes = createIntraNodePeerClearanceRoutes({
    separation: 3.5,
    peerCopperDiameter: 1.5,
    peerKind: "trace",
  })
  const connMap = new ConnectivityMap({
    "shared-net": ["via-route", "peer-route"],
    "foreign-net": ["foreign-route"],
  })
  const connectedSolver = createIntraNodePeerClearanceSolver({
    routes: connectedRoutes,
    scale: 0.25,
    connMap,
  })
  expect(connectedSolver["getFirstSolvedViaTraceConflict"]()).toBeNull()

  const foreignRoute: HighDensityIntraNodeRoute = {
    ...structuredClone(connectedRoutes[1]!),
    connectionName: "foreign-route",
    rootConnectionName: "foreign-root",
  }
  const routes = [...connectedRoutes, foreignRoute]
  const before = structuredClone(routes)
  const solver = createIntraNodePeerClearanceSolver({
    routes,
    scale: 0.25,
    connMap,
  })
  const conflict = solver["getFirstSolvedViaTraceConflict"]()
  expect(conflict?.route).toBe(connectedRoutes[0])
  expect(conflict?.conflictingRoute).toBe(foreignRoute)
  expect(routes).toEqual(before)
})
