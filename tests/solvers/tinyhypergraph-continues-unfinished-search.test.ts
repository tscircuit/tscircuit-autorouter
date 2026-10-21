import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/index"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments as RoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

function createRoutingProbe(allowContinuation: boolean): RoutingSolver {
  const nodeCount = 24
  const graph: Parameters<typeof loadSerializedHyperGraph>[0] = {
    regions: Array.from({ length: nodeCount }, (_, index) => ({
      regionId: `r${index}`,
      pointIds: [
        ...(index > 0 ? [`p${index - 1}`] : []),
        ...(index < nodeCount - 1 ? [`p${index}`] : []),
      ],
      d: { center: { x: index, y: 0 }, width: 1, height: 1, availableZ: [0] },
    })),
    ports: Array.from({ length: nodeCount - 1 }, (_, index) => ({
      portId: `p${index}`,
      region1Id: `r${index}`,
      region2Id: `r${index + 1}`,
      d: { x: index + 0.5, y: 0, z: 0 },
    })),
    connections: [
      { connectionId: "signal", startRegionId: "r0", endRegionId: "r23" },
    ],
  }
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver = new RoutingSolver(topology, problem, {
    MAX_ITERATIONS: 3,
    GREEDY_FINAL_ROUTE_ITERS: 0,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  if (allowContinuation) solver.initialRoutingIterationLimit = 300
  return solver
}

test("continuation finishes the actual pending search instead of accepting a failed route", (): void => {
  const original = createRoutingProbe(false)
  original.solve()
  expect(original.solved).toBe(false)
  expect(original.failed).toBe(true)
  expect(original.iterations).toBe(3)

  const continued = createRoutingProbe(true)
  continued.solve()
  expect(continued.solved).toBe(true)
  expect(continued.failed).toBe(false)
  expect(continued.iterations).toBeGreaterThan(3)
  expect(continued.MAX_ITERATIONS).toBe(300)
  expect(continued.state.unroutedRoutes).toHaveLength(0)
})
