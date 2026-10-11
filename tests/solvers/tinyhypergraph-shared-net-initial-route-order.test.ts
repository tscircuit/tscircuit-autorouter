import { expect, test } from "bun:test"
import { DuplicateCongestedPortSolverWithIndependentRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/DuplicateCongestedPortSolverWithIndependentRoutes"
import { initializeTinyHypergraphRouteOrder } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/initializeTinyHypergraphRouteOrder"
import {
  createTinyHypergraphCongestionFixture,
  createTinyHypergraphCongestionSolver,
} from "../fixtures/tinyhypergraph-congestion"

test("shared-net branches and equally pressured independent routes retain their upstream sequence", (): void => {
  const graph = createTinyHypergraphCongestionFixture()
  graph.connections![1]!.mutuallyConnectedNetworkId = "flexible-net"
  // These shared branches have different lengths. Global length tie-breaking
  // would reverse them, despite the upstream plan ordering the long branch
  // first. Give independent copies their own terminals on the same corridors.
  for (const [source, connectionId] of [
    [graph.connections![0]!, "independent-long"],
    [graph.connections![1]!, "independent-short"],
  ] as const) {
    const newEndpointRegionIds: string[] = []
    for (const [endpoint, regionId] of [
      ["start", source.startRegionId],
      ["end", source.endRegionId],
    ] as const) {
      const originalRegion = graph.regions.find((region) => region.regionId === regionId)!
      const originalPort = graph.ports.find((port) => port.portId === originalRegion.pointIds[0])!
      const neighborRegionId = originalPort.region1Id === regionId
        ? originalPort.region2Id
        : originalPort.region1Id
      const newRegionId = `${connectionId}-${endpoint}`
      const newPortId = `${connectionId}-${endpoint}-port`
      graph.regions.push({
        ...originalRegion,
        regionId: newRegionId,
        pointIds: [newPortId],
        d: { ...originalRegion.d },
      })
      graph.ports.push({
        ...originalPort,
        portId: newPortId,
        region1Id: newRegionId,
        region2Id: neighborRegionId,
        d: { ...originalPort.d },
      })
      graph.regions.find((region) => region.regionId === neighborRegionId)!.pointIds.push(newPortId)
      newEndpointRegionIds.push(newRegionId)
    }
    graph.connections!.push({
      ...source,
      connectionId,
      mutuallyConnectedNetworkId: connectionId,
      startRegionId: newEndpointRegionIds[0]!,
      endRegionId: newEndpointRegionIds[1]!,
    })
  }
  const prepass = new DuplicateCongestedPortSolverWithIndependentRoutes(graph)
  prepass.solve()
  expect(prepass.failed).toBeFalse()
  const solver = createTinyHypergraphCongestionSolver(graph)
  expect(solver.state.unroutedRoutes).toEqual([0, 1, 2, 3])
  const stats = initializeTinyHypergraphRouteOrder(solver, prepass.independentRouteSegments)
  expect(solver.state.unroutedRoutes).toEqual([0, 1, 2, 3])
  expect(stats.initialRouteOrderingChangedPositionCount).toBe(0)
  expect(solver.state.regionCongestionCost.every((cost) => cost === 0)).toBeTrue()

  const assignments = [
    ["left", "flex-in", "hot-in"],
    ["hot", "hot-in", "hot-out"],
    ["right", "hot-out", "flex-out"],
  ] as const
  for (const [regionId, fromPortId, toPortId] of assignments) {
    graph.regions.find((region) => region.regionId === regionId)!.assignments = [{
      connectionId: "flexible-route",
      regionPort1Id: fromPortId,
      regionPort2Id: toPortId,
    }]
  }
  const preloaded = createTinyHypergraphCongestionSolver(graph)
  expect(preloaded.state.unroutedRoutes).toEqual([1, 2, 3])
  const segmentsBefore = JSON.stringify(preloaded.state.regionSegments)
  const ownersBefore = [...preloaded.state.portAssignment]
  initializeTinyHypergraphRouteOrder(preloaded, prepass.independentRouteSegments)
  expect(preloaded.state.unroutedRoutes).toEqual([1, 2, 3])
  expect(JSON.stringify(preloaded.state.regionSegments)).toBe(segmentsBefore)
  expect([...preloaded.state.portAssignment]).toEqual(ownersBefore)
})
