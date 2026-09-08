import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"

test("an empty loaded TinyGraph has explicit empty metadata and completes with physical context", (): void => {
  const { topology, problem } = loadSerializedHyperGraph({
    regions: [],
    ports: [],
    connections: [],
  })
  expect(problem.routeCount).toBe(0)
  expect(problem.routeMetadata).toEqual([])
  const context = createTinyGraphFixedCopperClearanceContext({
    problem,
    clearanceIndex: new FixedCopperClearanceIndex({
      rectangles: [],
      layerCount: 2,
      minClearance: 0.1,
    }),
    traceWidth: 0.15,
  })
  expect(context.loadedProblem).toBe(problem)
  expect(context.canonicalNetIdByNetId.size).toBe(0)
  expect(context.netIdByCanonicalNetId.size).toBe(0)
  expect(context.connectionIdByRouteId).toEqual([])
  const solver = new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
    topology,
    problem,
    undefined,
    context,
  )
  expect(solver.problemSetup.portEndpointReservationNetId).toHaveLength(0)
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(solver.state.regionSegments).toEqual([])
})
