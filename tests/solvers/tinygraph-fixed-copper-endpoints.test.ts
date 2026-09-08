import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPhysicalReservationProblem } from "../fixtures/tinygraph/createPhysicalReservationProblem"

test("unrouted physical starts ends and equal endpoints cannot bypass reservations", (): void => {
  for (const endpoint of ["start", "end", "same-port"]) {
    const { topology, problem } = createPhysicalReservationProblem()
    if (endpoint === "same-port") problem.routeEndPort[0] = 0
    const index = new FixedCopperClearanceIndex({
      rectangles: [
        {
          kind: "fixed-rectangle",
          center: { x: endpoint === "end" ? 1 : -1, y: 0 },
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
    expect((): void => {
      void solver.problemSetup
    }).toThrow(
      `route 0 ${endpoint === "end" ? "end" : "start"} port`,
    )
    expect(solver.solved).toBeFalse()
    expect(solver.state.regionSegments).toEqual([[]])
  }
})
