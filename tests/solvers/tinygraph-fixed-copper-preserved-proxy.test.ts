import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPhysicalReservationProblem } from "../fixtures/tinygraph/createPhysicalReservationProblem"

test("unchanged initial assignments are not rejected as new copper at their logical proxy coordinates", (): void => {
  const { topology, problem } = createPhysicalReservationProblem()
  problem.initialAssignments = [
    { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 2 },
  ]
  const originalProblem = structuredClone(problem)
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: -1, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [0],
        ownerNetIds: new Set(["net-b"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.05,
  })
  const solver = new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
    topology,
    problem,
    undefined,
    createTinyGraphFixedCopperClearanceContext({
      problem,
      clearanceIndex: index,
      traceWidth: 0.1,
    }),
  )
  expect(solver.state.unroutedRoutes).toEqual([1])
  expect(solver.problemSetup.portEndpointReservationNetId[0]).toBe(-2)
  expect(solver.state.regionSegments).toEqual([[[0, 0, 2]]])
  expect(solver.state.portAssignment[0]).toBe(7)
  expect(solver.state.portAssignment[2]).toBe(7)
  solver.resetRoutingStateForRerip()
  expect(solver.state.unroutedRoutes).toEqual([1])
  expect(solver.state.regionSegments).toEqual([[[0, 0, 2]]])
  expect(problem).toEqual(originalProblem)
  expect(solver.failed).toBeFalse()
})
