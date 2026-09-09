import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPhysicalReservationProblem } from "../fixtures/tinygraph/createPhysicalReservationProblem"

test("physical port reservations intersect native ownership at each actual layer and duplicate coordinate", (): void => {
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
  const originalProblem = structuredClone(problem)
  const context = createTinyGraphFixedCopperClearanceContext({
    problem,
    clearanceIndex: index,
    traceWidth: 0.1,
  })
  expect([...context.netIdByCanonicalNetId]).toEqual([
    ["net-a", 7],
    ["net-b", 11],
  ])
  const solver =
    new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
      topology,
      problem,
      undefined,
      context,
    )
  const setup = solver.problemSetup
  expect([...setup.portEndpointReservationNetId]).toEqual([
    7, 11, 7, -1, 11, -1, 11,
  ])
  expect([...setup.portEndpointNetIds[1]!]).toEqual([])
  solver.state.currentRouteNetId = 7
  expect(solver.isPortReservedForDifferentNet(1)).toBeTrue()
  solver.state.currentRouteNetId = 11
  expect(solver.isPortReservedForDifferentNet(1)).toBeFalse()
  expect(problem).toEqual(originalProblem)

  // A physical reservation never grants another net access to a native terminal.
  problem.routeStartPort[0] = 1
  const conflicting =
    new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
      topology,
      problem,
      undefined,
      context,
    )
  expect((): void => {
    void conflicting.problemSetup
  }).toThrow('connection "route-a"')
})
