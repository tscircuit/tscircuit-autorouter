import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/index"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

class BudgetProbeSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  captureCompleteAssignmentAtLimit(): void {
    this.captureBestSolvedState({ maxRegionCost: 0, totalRegionCost: 0 })
    this.solved = false
    this.iterations = this.MAX_ITERATIONS
  }
}

function createBudgetProbe(
  initialRoutingMaxIterations?: number,
): BudgetProbeSolver {
  const { topology, problem } = loadSerializedHyperGraph({
    regions: [
      { regionId: "start", pointIds: ["port"], d: { availableZ: [0] } },
      { regionId: "end", pointIds: ["port"], d: { availableZ: [0] } },
    ],
    ports: [
      {
        portId: "port",
        region1Id: "start",
        region2Id: "end",
        d: { x: 0, y: 0, z: 0 },
      },
    ],
    connections: [
      { connectionId: "signal", startRegionId: "start", endRegionId: "end" },
    ],
  })
  return new BudgetProbeSolver(topology, problem, {
    MAX_ITERATIONS: 100,
    INITIAL_ROUTING_MAX_ITERATIONS: initialRoutingMaxIterations,
    GREEDY_FINAL_ROUTE_ITERS: 0,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
  })
}

test("only opted-in incomplete first assignments can extend the original limit", (): void => {
  const legacy = createBudgetProbe()
  legacy.iterations = legacy.MAX_ITERATIONS
  legacy.tryFinalAcceptance()
  expect(legacy.MAX_ITERATIONS).toBe(100)

  const incomplete = createBudgetProbe(1_600)
  incomplete.iterations = incomplete.MAX_ITERATIONS
  incomplete.tryFinalAcceptance()
  expect(incomplete.MAX_ITERATIONS).toBe(1_600)
  expect(incomplete.solved).toBe(false)
  expect(incomplete.failed).toBe(false)
  incomplete.iterations = incomplete.MAX_ITERATIONS
  incomplete.tryFinalAcceptance()
  expect(incomplete.MAX_ITERATIONS).toBe(1_600)

  const complete = createBudgetProbe(1_600)
  complete.solve()
  expect(complete.solved).toBe(true)
  complete.captureCompleteAssignmentAtLimit()
  complete.tryFinalAcceptance()
  expect(complete.MAX_ITERATIONS).toBe(100)
  expect(complete.solved).toBe(true)
  expect(complete.failed).toBe(false)
})
