import { expect, test } from "bun:test"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/index"
import { DuplicateCongestedPortSolverWithIndependentRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/DuplicateCongestedPortSolverWithIndependentRoutes"
import { createTinyHypergraphCongestionFixture } from "../fixtures/tinyhypergraph-congestion"

test("retaining independent routes preserves exact duplication topology and demand counts", (): void => {
  const graph = createTinyHypergraphCongestionFixture()
  graph.connections!.push({
    ...graph.connections![0]!,
    connectionId: "flexible-second-route",
  })
  graph.regions[2]!.assignments = [{
    connectionId: "fixed-route",
    regionPort1Id: "fixed-in",
    regionPort2Id: "fixed-out",
  }]
  const options = {
    useSerializedPortPenalties: false,
    routeSolveOptions: { RIP_THRESHOLD_RAMP_ATTEMPTS: 0 },
  }
  const originalGraph = JSON.stringify(graph)
  const baseline = new DuplicateCongestedPortSolver(graph, options)
  const retained = new DuplicateCongestedPortSolverWithIndependentRoutes(graph, options)
  baseline.solve()
  retained.solve()

  expect(baseline.solved).toBeTrue()
  expect(retained.solved).toBeTrue()
  expect(baseline.failed).toBeFalse()
  expect(retained.failed).toBeFalse()
  expect(JSON.stringify(graph)).toBe(originalGraph)
  expect(JSON.stringify(retained.getOutput())).toBe(JSON.stringify(baseline.getOutput()))
  expect(retained.report).toEqual(baseline.report)
  expect(retained.report.duplicatedPorts.length).toBeGreaterThan(0)
  expect(retained.independentRouteSegments).toHaveLength(7)
  expect(retained.independentRouteSegments.filter((segment) =>
    segment.connectionId === "fixed-route",
  )).toEqual([{
    connectionId: "fixed-route",
    regionId: "hot",
    fromPortId: "fixed-in",
    toPortId: "fixed-out",
  }])
  expect(retained.stats.independentRouteSegmentCount).toBe(7)
})
