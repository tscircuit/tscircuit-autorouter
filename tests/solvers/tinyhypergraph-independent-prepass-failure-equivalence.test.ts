import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  DuplicateCongestedPortSolver,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"
import { DuplicateCongestedPortSolverWithIndependentRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/DuplicateCongestedPortSolverWithIndependentRoutes"

test("retaining independent paths preserves unreachable and iteration-limit prepass failure reports", (): void => {
  // Both endpoints have valid incident ports and regions. The two islands
  // have no connecting port, so the route is genuinely disconnected.
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "start",
        pointIds: ["start-port"],
        d: { center: { x: -1.5, y: 0 }, width: 1, height: 1, availableZ: [0] },
      },
      {
        regionId: "left-island",
        pointIds: ["start-port"],
        d: { center: { x: -0.5, y: 0 }, width: 1, height: 1, availableZ: [0] },
      },
      {
        regionId: "right-island",
        pointIds: ["end-port"],
        d: { center: { x: 0.5, y: 0 }, width: 1, height: 1, availableZ: [0] },
      },
      {
        regionId: "end",
        pointIds: ["end-port"],
        d: { center: { x: 1.5, y: 0 }, width: 1, height: 1, availableZ: [0] },
      },
    ],
    ports: [
      {
        portId: "start-port",
        region1Id: "start",
        region2Id: "left-island",
        d: { x: -1, y: 0, z: 0 },
      },
      {
        portId: "end-port",
        region1Id: "right-island",
        region2Id: "end",
        d: { x: 1, y: 0, z: 0 },
      },
    ],
    connections: [{
      connectionId: "disconnected-route",
      startRegionId: "start",
      endRegionId: "end",
      mutuallyConnectedNetworkId: "disconnected-net",
    }],
  }
  const cases: Array<{
    routeSolveOptions: TinyHyperGraphSolverOptions
    expectedError: string
  }> = [
    {
      routeSolveOptions: { STATIC_REACHABILITY_PRECHECK: true },
      expectedError: "Static reachability precheck failed",
    },
    {
      routeSolveOptions: {
        STATIC_REACHABILITY_PRECHECK: false,
        MAX_ITERATIONS: 1,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
        GREEDY_FINAL_ROUTE_ITERS: 0,
      },
      expectedError: "ran out of iterations",
    },
  ]
  const originalInput = JSON.stringify(graph)
  for (const { routeSolveOptions, expectedError } of cases) {
    const baseline = new DuplicateCongestedPortSolver(graph, { routeSolveOptions })
    const retained = new DuplicateCongestedPortSolverWithIndependentRoutes(graph, { routeSolveOptions })
    expect((): void => baseline.solve()).not.toThrow()
    expect((): void => retained.solve()).not.toThrow()
    expect(baseline.failed).toBeTrue()
    expect(baseline.solved).toBeFalse()
    expect(retained.failed).toBe(baseline.failed)
    expect(retained.solved).toBe(baseline.solved)
    expect(retained.error).toBe(baseline.error)
    expect(retained.error).toContain("Route 0 could not be solved independently:")
    expect(retained.error).toContain(expectedError)
    expect(retained.report).toEqual(baseline.report)
    expect(retained.report).toEqual({ portUseCounts: {}, duplicatedPorts: [] })
    expect(retained.independentRouteSegments).toHaveLength(0)
    expect(baseline.revisedSerializedHyperGraph).toBeUndefined()
    expect(retained.revisedSerializedHyperGraph).toBeUndefined()
    expect((): SerializedHyperGraph => baseline.getOutput()).toThrow("does not have a repaired topology output")
    expect((): SerializedHyperGraph => retained.getOutput()).toThrow("does not have a repaired topology output")
    expect(JSON.stringify(graph)).toBe(originalInput)
  }
})
