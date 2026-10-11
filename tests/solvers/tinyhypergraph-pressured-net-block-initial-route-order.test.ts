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

test("a pressured longer net precedes a shorter equal-cardinality net without reordering either branch sequence", (): void => {
  const shortNet = createSharedNetGraph("short", 0.5, 0)
  const longNet = createSharedNetGraph("long", 1, 2)
  const intruderEndpoints: string[] = []
  // Give the distinct crossing net its own terminals. Its vertical path
  // crosses only the long net's horizontal branch in the shared hot region.
  for (const [endpoint, originalRegionId] of [
    ["start", "long-fixed-start"],
    ["end", "long-fixed-end"],
  ] as const) {
    const originalRegion = longNet.regions.find((region) => region.regionId === originalRegionId)!
    const originalPort = longNet.ports.find((port) => port.portId === originalRegion.pointIds[0])!
    const regionId = `intruder-${endpoint}`
    const portId = `intruder-${endpoint}-port`
    longNet.regions.push({
      ...originalRegion,
      regionId,
      pointIds: [portId],
      d: { ...originalRegion.d },
    })
    longNet.ports.push({
      ...originalPort,
      portId,
      region1Id: regionId,
      region2Id: "long-hot",
      d: { ...originalPort.d },
    })
    longNet.regions.find((region) => region.regionId === "long-hot")!.pointIds.push(portId)
    intruderEndpoints.push(regionId)
  }
  const graph: SerializedHyperGraph = {
    regions: [...shortNet.regions, ...longNet.regions],
    ports: [...shortNet.ports, ...longNet.ports],
    connections: [
      ...shortNet.connections!,
      // The pressured branch is deliberately second in its upstream plan.
      longNet.connections![1]!,
      longNet.connections![0]!,
      {
        connectionId: "intruder-route",
        mutuallyConnectedNetworkId: "intruder-net",
        startRegionId: intruderEndpoints[0]!,
        endRegionId: intruderEndpoints[1]!,
      },
    ],
  }
  const prepass = new DuplicateCongestedPortSolverWithIndependentRoutes(graph)
  prepass.solve()
  expect(prepass.failed).toBeFalse()
  const solver = createTinyHypergraphCongestionSolver(graph)
  expect(solver.state.unroutedRoutes).toEqual([0, 1, 2, 3, 4])
  const stats = initializeTinyHypergraphRouteOrder(solver, prepass.independentRouteSegments)
  expect(solver.state.unroutedRoutes).toEqual([2, 3, 0, 1, 4])
  expect(stats.initialRouteOrderingMaxConflictDegree).toBe(1)
  expect(stats.initialRouteOrderingMaxPriority).toBe(1)
  expect(stats.initialRouteOrderingChangedPositionCount).toBe(4)
  expect(solver.state.regionCongestionCost.every((cost) => cost === 0)).toBeTrue()

  const withoutIntruder: SerializedHyperGraph = {
    ...graph,
    connections: graph.connections!.slice(0, 4),
  }
  const unpressuredPrepass = new DuplicateCongestedPortSolverWithIndependentRoutes(withoutIntruder)
  unpressuredPrepass.solve()
  expect(unpressuredPrepass.failed).toBeFalse()
  const unpressured = createTinyHypergraphCongestionSolver(withoutIntruder)
  const unpressuredStats = initializeTinyHypergraphRouteOrder(unpressured, unpressuredPrepass.independentRouteSegments)
  expect(unpressuredStats.initialRouteOrderingMaxPriority).toBe(0)
  // Removing only the crossing demand leaves the shorter block first.
  expect(unpressured.state.unroutedRoutes).toEqual([0, 1, 2, 3])
})
