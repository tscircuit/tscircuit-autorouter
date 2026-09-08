import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPhysicalReservationProblem } from "../fixtures/tinygraph/createPhysicalReservationProblem"

class PartialEndpointProbe extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  activatePartialRoute(start: number, end: number): void {
    this.PARTIAL_RIP_ENABLED = true
    this.partialRipRoutePlans.set(0, {
      routeId: 0,
      activeStartPortId: start,
      activeEndPortId: end,
      forcedStartRegionId: 0,
      forcedEndRegionId: 0,
      rippedSegmentCount: 1,
      retainedSegmentCount: 1,
    })
    this.state.currentRouteId = 0
    this.state.currentRouteNetId = this.problem.routeNet[0]
  }

  getActiveEndpoint(endpoint: "start" | "end"): number {
    if (endpoint === "start") {
      return this.getRouteStartPortId(0)
    }
    return this.getRouteEndPortId(0)
  }
}

test("physical endpoint checks use the inherited partial-rip endpoints instead of original terminals", (): void => {
  const { topology, problem } = createPhysicalReservationProblem()
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [0],
        ownerNetIds: new Set(["net-b"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.05,
  })
  const solver = new PartialEndpointProbe(
    topology,
    problem,
    undefined,
    createTinyGraphFixedCopperClearanceContext({
      problem,
      clearanceIndex: index,
      traceWidth: 0.1,
    }),
  )
  expect(solver.problemSetup.portEndpointReservationNetId[1]).toBe(11)
  solver.activatePartialRoute(1, 2)
  expect((): number => solver.getActiveEndpoint("start")).toThrow(
    "start port 1",
  )
  solver.activatePartialRoute(0, 1)
  expect(solver.getActiveEndpoint("start")).toBe(0)
  expect((): number => solver.getActiveEndpoint("end")).toThrow("end port 1")
})
