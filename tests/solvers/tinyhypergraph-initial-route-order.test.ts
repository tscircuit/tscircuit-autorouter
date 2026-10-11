import { expect, test } from "bun:test"
import { shuffle } from "tiny-hypergraph/lib/shuffle"
import { DuplicateCongestedPortSolverWithIndependentRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/DuplicateCongestedPortSolverWithIndependentRoutes"
import { initializeTinyHypergraphRouteOrder } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/initializeTinyHypergraphRouteOrder"
import {
  createTinyHypergraphCongestionFixture,
  createTinyHypergraphCongestionSolver,
} from "../fixtures/tinyhypergraph-congestion"

test("constrained initialization preserves net priority and preloaded state and changes only the first route order", (): void => {
  const graph = createTinyHypergraphCongestionFixture()
  // Give the flexible route two physical transit choices at each boundary.
  // The crossing route has only its direct path, so pressure/scarcity alone
  // moves it first without relying on a path-length tie-breaker.
  for (const [portId, region1Id, region2Id, x] of [
    ["hot-in-second", "left", "hot", -0.2],
    ["hot-out-second", "hot", "right", 0.2],
  ] as const) {
    graph.ports.push({ portId, region1Id, region2Id, d: { x, y: 0.1, z: 0 } })
    graph.regions.find((region) => region.regionId === region1Id)!.pointIds.push(portId)
    graph.regions.find((region) => region.regionId === region2Id)!.pointIds.push(portId)
  }
  const forecast = new DuplicateCongestedPortSolverWithIndependentRoutes(graph)
  forecast.solve()
  expect(forecast.failed).toBeFalse()
  const segments = forecast.independentRouteSegments
  const baseline = createTinyHypergraphCongestionSolver(graph)
  const initialized = createTinyHypergraphCongestionSolver(graph)
  const repeated = createTinyHypergraphCongestionSolver(graph)
  const originalReset = initialized.resetRoutingStateForRerip
  const stats = initializeTinyHypergraphRouteOrder(initialized, segments)
  initializeTinyHypergraphRouteOrder(repeated, segments)
  expect(initialized.state.unroutedRoutes).toEqual([1, 0])
  expect(repeated.state.unroutedRoutes).toEqual(initialized.state.unroutedRoutes)
  expect(stats.initialRouteOrderingMaxConflictDegree).toBe(1)
  expect(stats.initialRouteOrderingChangedPositionCount).toBe(2)
  expect(initialized.state.regionCongestionCost.every((cost) => cost === 0)).toBeTrue()
  expect(initialized.resetRoutingStateForRerip).toBe(originalReset)
  baseline.solve()
  initialized.solve()
  expect(baseline.state.regionIntersectionCaches[2]!.existingSameLayerIntersections).toBe(1)
  expect(initialized.state.regionIntersectionCaches[2]!.existingSameLayerIntersections).toBe(0)
  expect(initialized.solved).toBeTrue()
  initialized.state.ripCount = 1
  initialized.resetRoutingStateForRerip()
  expect(initialized.state.unroutedRoutes).toEqual(shuffle([0, 1], 1))
  expect(() => initializeTinyHypergraphRouteOrder(initialized, segments)).toThrow()

  const groupedGraph = createTinyHypergraphCongestionFixture()
  groupedGraph.connections!.push({
    ...groupedGraph.connections![0]!,
    connectionId: "flexible-second-route",
  })
  groupedGraph.connections = [
    groupedGraph.connections![0]!,
    groupedGraph.connections![2]!,
    groupedGraph.connections![1]!,
  ]
  const groupedForecast = new DuplicateCongestedPortSolverWithIndependentRoutes(groupedGraph)
  groupedForecast.solve()
  expect(groupedForecast.failed).toBeFalse()
  const grouped = createTinyHypergraphCongestionSolver(groupedGraph)
  const groupedStats = initializeTinyHypergraphRouteOrder(grouped, groupedForecast.independentRouteSegments)
  expect(grouped.state.unroutedRoutes).toEqual([0, 1, 2])
  const duplicated = createTinyHypergraphCongestionSolver(groupedForecast.getOutput())
  const duplicatedStats = initializeTinyHypergraphRouteOrder(duplicated, groupedForecast.independentRouteSegments)
  expect(groupedForecast.report.duplicatedPorts.length).toBeGreaterThan(0)
  expect(duplicated.state.unroutedRoutes).toEqual(grouped.state.unroutedRoutes)
  expect(duplicatedStats.initialRouteOrderingMaxPriority).toBe(groupedStats.initialRouteOrderingMaxPriority)

  const sharedNetGraph = createTinyHypergraphCongestionFixture()
  sharedNetGraph.connections![1]!.mutuallyConnectedNetworkId = "flexible-net"
  const sharedNetForecast = new DuplicateCongestedPortSolverWithIndependentRoutes(sharedNetGraph)
  sharedNetForecast.solve()
  expect(sharedNetForecast.failed).toBeFalse()
  const sharedNet = createTinyHypergraphCongestionSolver(sharedNetGraph)
  const sharedNetStats = initializeTinyHypergraphRouteOrder(sharedNet, sharedNetForecast.independentRouteSegments)
  expect(sharedNetStats.initialRouteOrderingMaxConflictDegree).toBe(0)
  expect(sharedNetStats.initialRouteOrderingMaxPriority).toBe(0)
  expect(sharedNet.state.unroutedRoutes).toEqual([0, 1])

  const preloadedGraph = createTinyHypergraphCongestionFixture()
  preloadedGraph.regions[2]!.assignments = [{
    connectionId: "fixed-route",
    regionPort1Id: "fixed-in",
    regionPort2Id: "fixed-out",
  }]
  const preloadedForecast = new DuplicateCongestedPortSolverWithIndependentRoutes(preloadedGraph)
  preloadedForecast.solve()
  expect(preloadedForecast.failed).toBeFalse()
  const preloaded = createTinyHypergraphCongestionSolver(preloadedGraph)
  expect(preloaded.state.unroutedRoutes).toEqual([0])
  const assignmentsBefore = [...preloaded.state.portAssignment]
  const segmentsBefore = JSON.stringify(preloaded.state.regionSegments)
  const cacheBefore = JSON.stringify(preloaded.state.regionIntersectionCaches)
  initializeTinyHypergraphRouteOrder(preloaded, preloadedForecast.independentRouteSegments)
  expect(preloaded.state.unroutedRoutes).toEqual([0])
  expect([...preloaded.state.portAssignment]).toEqual(assignmentsBefore)
  expect(JSON.stringify(preloaded.state.regionSegments)).toBe(segmentsBefore)
  expect(JSON.stringify(preloaded.state.regionIntersectionCaches)).toBe(cacheBefore)
})
