import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "tiny-hypergraph/lib/prepared/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import {
  NativeRoutingSolverWithGraphSizedCompletion,
  PreparedRoutingSolverWithGraphSizedCompletion,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/graphSizedCompletionSolvers"

test("routing completion can traverse a graph larger than its old fixed budget", (): void => {
  const regionCount = 60_010
  const graph: SerializedHyperGraph = {
    regions: Array.from({ length: regionCount }, (_, index) => ({
      regionId: `region-${index}`,
      pointIds: [
        ...(index > 0 ? [`port-${index - 1}`] : []),
        ...(index + 1 < regionCount ? [`port-${index}`] : []),
      ],
      d: { center: { x: index, y: 0 }, width: 1, height: 1, availableZ: [0] },
    })),
    ports: Array.from({ length: regionCount - 1 }, (_, index) => ({
      portId: `port-${index}`,
      region1Id: `region-${index}`,
      region2Id: `region-${index + 1}`,
      d: { x: index + 0.5, y: 0, z: 0 },
    })),
    connections: [{
      connectionId: "long-route",
      startRegionId: "region-0",
      endRegionId: `region-${regionCount - 1}`,
    }],
  }
  const { topology, problem } = loadSerializedHyperGraph(graph)
  for (const Solver of [
    SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments,
    NativeRoutingSolverWithGraphSizedCompletion,
    PreparedRoutingSolverWithGraphSizedCompletion,
  ]) {
    const solver = new Solver(topology, problem, {
      MAX_ITERATIONS: 1,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
      GREEDY_FINAL_ROUTE_ITERS: 1,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    })
    solver.solve()
    if (Solver === SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments) {
      expect(solver.failed).toBe(true)
      continue
    }
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.state.unroutedRoutes).toHaveLength(0)
    expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBe(true)
  }
})
