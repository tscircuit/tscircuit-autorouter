import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolverWithIndependentRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/DuplicateCongestedPortSolverWithIndependentRoutes"
import { initializeTinyHypergraphRouteOrder } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/initializeTinyHypergraphRouteOrder"
import {
  createTinyHypergraphCongestionFixture,
  createTinyHypergraphCongestionSolver,
} from "../fixtures/tinyhypergraph-congestion"

const createSharedNetGraph = (
  prefix: string,
  scale: number,
  offset: number,
): SerializedHyperGraph => {
  const graph = createTinyHypergraphCongestionFixture()
  for (const region of graph.regions) {
    region.regionId = `${prefix}-${region.regionId}`
    region.pointIds = region.pointIds.map((portId): string => `${prefix}-${portId}`)
    region.d.center = {
      x: region.d.center.x * scale + offset,
      y: region.d.center.y * scale,
    }
    region.d.width *= scale
    region.d.height *= scale
  }
  for (const port of graph.ports) {
    port.portId = `${prefix}-${port.portId}`
    port.region1Id = `${prefix}-${port.region1Id}`
    port.region2Id = `${prefix}-${port.region2Id}`
    port.d.x = port.d.x * scale + offset
    port.d.y *= scale
  }
  for (const connection of graph.connections!) {
    connection.connectionId = `${prefix}-${connection.connectionId}`
    connection.startRegionId = `${prefix}-${connection.startRegionId}`
    connection.endRegionId = `${prefix}-${connection.endRegionId}`
    connection.mutuallyConnectedNetworkId = `${prefix}-net`
  }
  return graph
}

test("unpressured net blocks retain their upstream order and branch sequence despite unequal lengths", (): void => {
  const longNet = createSharedNetGraph("long", 1, 0)
  const shortNet = createSharedNetGraph("short", 0.5, 2)
  const singleton = createSharedNetGraph("singleton", 1, 4)
  const graph: SerializedHyperGraph = {
    regions: [...longNet.regions, ...shortNet.regions, ...singleton.regions],
    ports: [...longNet.ports, ...shortNet.ports, ...singleton.ports],
    // Both shared nets deliberately plan their longer branch first, and the
    // longer complete net comes first. With no crossing pressure, neither
    // branch length nor total net length should change this upstream plan.
    // The singleton's original cardinality-class position also stays intact.
    connections: [
      ...longNet.connections!,
      singleton.connections![1]!,
      ...shortNet.connections!,
    ],
  }
  const prepass = new DuplicateCongestedPortSolverWithIndependentRoutes(graph)
  prepass.solve()
  expect(prepass.failed).toBeFalse()
  const solver = createTinyHypergraphCongestionSolver(graph)
  expect(solver.state.unroutedRoutes).toEqual([0, 1, 2, 3, 4])
  const stats = initializeTinyHypergraphRouteOrder(solver, prepass.independentRouteSegments)
  expect(solver.state.unroutedRoutes).toEqual([0, 1, 2, 3, 4])
  expect(stats.initialRouteOrderingMaxPriority).toBe(0)
  expect(stats.initialRouteOrderingChangedPositionCount).toBe(0)
  expect(solver.state.regionCongestionCost.every((cost) => cost === 0)).toBeTrue()

  const repeated = createTinyHypergraphCongestionSolver(graph)
  initializeTinyHypergraphRouteOrder(repeated, prepass.independentRouteSegments)
  expect(repeated.state.unroutedRoutes).toEqual(solver.state.unroutedRoutes)

  const interleaved = createTinyHypergraphCongestionSolver(graph)
  interleaved.state.unroutedRoutes = [0, 3, 2, 1, 4]
  const interleavedStats = initializeTinyHypergraphRouteOrder(interleaved, prepass.independentRouteSegments)
  expect(interleaved.state.unroutedRoutes).toEqual([0, 3, 2, 1, 4])
  expect(interleavedStats.initialRouteOrderingChangedPositionCount).toBe(0)

  const assignments = [
    ["left", "flex-in", "hot-in"],
    ["hot", "hot-in", "hot-out"],
    ["right", "hot-out", "flex-out"],
  ] as const
  for (const [regionId, fromPortId, toPortId] of assignments) {
    graph.regions.find((region) => region.regionId === `short-${regionId}`)!.assignments = [{
      connectionId: "short-flexible-route",
      regionPort1Id: `short-${fromPortId}`,
      regionPort2Id: `short-${toPortId}`,
    }]
  }
  const preloaded = createTinyHypergraphCongestionSolver(graph)
  expect(preloaded.state.unroutedRoutes).toEqual([0, 1, 2, 4])
  const segmentsBefore = JSON.stringify(preloaded.state.regionSegments)
  const ownersBefore = [...preloaded.state.portAssignment]
  initializeTinyHypergraphRouteOrder(preloaded, prepass.independentRouteSegments)
  // The partly committed net still belongs to the full two-branch class.
  // Its remaining branch must not take the singleton's reserved queue slot.
  expect(preloaded.state.unroutedRoutes).toEqual([0, 1, 2, 4])
  expect(JSON.stringify(preloaded.state.regionSegments)).toBe(segmentsBefore)
  expect([...preloaded.state.portAssignment]).toEqual(ownersBefore)
})
