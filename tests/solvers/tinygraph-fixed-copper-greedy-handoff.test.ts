import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { createPhysicalReservationProblem } from "../fixtures/tinygraph/createPhysicalReservationProblem"

class GreedyHandoffProbe extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  handOffRemainingRoute(child: TinyHyperGraphSolver): void {
    this.applySnapshotToGreedyFinalRouteSolver(
      child,
      {
        portAssignment: this.state.portAssignment,
        regionSegments: this.state.regionSegments,
        regionIntersectionCaches: this.state.regionIntersectionCaches,
        regionCongestionCost: this.state.regionCongestionCost,
        ripCount: this.state.ripCount,
      },
      [0],
    )
  }
}

test("native greedy children receive physical reservations and checked remaining endpoints", (): void => {
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
  for (const blockedStart of [false, true]) {
    const { topology, problem } = createPhysicalReservationProblem()
    if (blockedStart) problem.routeStartPort[0] = 1
    const parent = new GreedyHandoffProbe(
      topology,
      problem,
      undefined,
      createTinyGraphFixedCopperClearanceContext({
        problem,
        clearanceIndex: index,
        traceWidth: 0.1,
      }),
    )
    const child = new TinyHyperGraphSolver(topology, problem)
    if (blockedStart) {
      expect((): void => parent.handOffRemainingRoute(child)).toThrow(
        "start port 1",
      )
    } else {
      parent.handOffRemainingRoute(child)
      expect(child.state.unroutedRoutes).toEqual([0])
      expect(child.problemSetup.portEndpointReservationNetId[1]).toBe(11)
      child.state.currentRouteNetId = 7
      expect(child.isPortReservedForDifferentNet(1)).toBeTrue()
      child.state.currentRouteNetId = 11
      expect(child.isPortReservedForDifferentNet(1)).toBeFalse()
    }
    expect(child.solved).toBeFalse()
  }
})
