import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolverWithIndependentRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/DuplicateCongestedPortSolverWithIndependentRoutes"
import { initializeTinyHypergraphRouteOrder } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/initializeTinyHypergraphRouteOrder"
import {
  createTinyHypergraphCongestionFixture,
  createTinyHypergraphCongestionSolver,
} from "../fixtures/tinyhypergraph-congestion"

const createIntrudedNetGraph = (
  prefix: string,
  scale: number,
  offset: number,
  intruderZ: number,
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
    region.d.availableZ = [0, 1]
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
  const intruderEndpoints: string[] = []
  for (const [endpoint, originalRegionId] of [
    ["start", `${prefix}-fixed-start`],
    ["end", `${prefix}-fixed-end`],
  ] as const) {
    const originalRegion = graph.regions.find((region) => region.regionId === originalRegionId)!
    const originalPort = graph.ports.find((port) => port.portId === originalRegion.pointIds[0])!
    const regionId = `${prefix}-intruder-${endpoint}`
    const portId = `${prefix}-intruder-${endpoint}-port`
    graph.regions.push({
      ...originalRegion,
      regionId,
      pointIds: [portId],
      d: { ...originalRegion.d },
    })
    graph.ports.push({
      ...originalPort,
      portId,
      region1Id: regionId,
      region2Id: `${prefix}-hot`,
      d: { ...originalPort.d, z: intruderZ },
    })
    graph.regions.find((region) => region.regionId === `${prefix}-hot`)!.pointIds.push(portId)
    intruderEndpoints.push(regionId)
  }
  graph.connections!.push({
    connectionId: `${prefix}-intruder-route`,
    mutuallyConnectedNetworkId: `${prefix}-intruder-net`,
    startRegionId: intruderEndpoints[0]!,
    endRegionId: intruderEndpoints[1]!,
  })
  return graph
}

test("layer-overlapping pressure precedes disjoint-layer pressure while preserving net blocks and integer conflict degree", (): void => {
  const shortNet = createIntrudedNetGraph("short", 0.5, 0, 1)
  const longNet = createIntrudedNetGraph("long", 1, 2, 0)
  const graph: SerializedHyperGraph = {
    regions: [...shortNet.regions, ...longNet.regions],
    ports: [...shortNet.ports, ...longNet.ports],
    connections: [
      // In both nets, the pressured horizontal branch is deliberately second.
      shortNet.connections![1]!,
      shortNet.connections![0]!,
      longNet.connections![1]!,
      longNet.connections![0]!,
      shortNet.connections![2]!,
      longNet.connections![2]!,
    ],
  }
  const prepass = new DuplicateCongestedPortSolverWithIndependentRoutes(graph)
  prepass.solve()
  expect(prepass.failed).toBeFalse()
  const solver = createTinyHypergraphCongestionSolver(graph)
  expect(solver.state.unroutedRoutes).toEqual([0, 1, 2, 3, 4, 5])
  const stats = initializeTinyHypergraphRouteOrder(solver, prepass.independentRouteSegments)
  // The longer net's same-layer crossing outweighs the shorter net's crossing
  // on disjoint single-layer masks. Neither net's branch sequence is reversed.
  expect(solver.state.unroutedRoutes).toEqual([2, 3, 0, 1, 5, 4])
  expect(stats.initialRouteOrderingMaxConflictDegree).toBe(1)
  expect(stats.initialRouteOrderingMaxPriority).toBe(1)
  expect(solver.state.regionCongestionCost.every((cost) => cost === 0)).toBeTrue()

  for (const port of graph.ports) {
    if (port.portId.startsWith("short-intruder-")) port.d.z = 0
  }
  const equalLayerPrepass = new DuplicateCongestedPortSolverWithIndependentRoutes(graph)
  equalLayerPrepass.solve()
  expect(equalLayerPrepass.failed).toBeFalse()
  const equalLayers = createTinyHypergraphCongestionSolver(graph)
  const equalStats = initializeTinyHypergraphRouteOrder(equalLayers, equalLayerPrepass.independentRouteSegments)
  // Change only endpoint Z: equal pressure restores the shorter blocks first.
  expect(equalLayers.state.unroutedRoutes).toEqual([0, 1, 2, 3, 4, 5])
  expect(equalStats.initialRouteOrderingMaxConflictDegree).toBe(1)
  expect(equalStats.initialRouteOrderingMaxPriority).toBe(1)

  const equalPressureLongFirst = createTinyHypergraphCongestionSolver(graph)
  equalPressureLongFirst.state.unroutedRoutes = [2, 0, 3, 1, 5, 4]
  const equalPressureStats = initializeTinyHypergraphRouteOrder(equalPressureLongFirst, equalLayerPrepass.independentRouteSegments)
  // Both nets have positive pressure 1, but the upstream plan puts the twice
  // as long net first and interleaves both nets' branches. Equal pressure must
  // preserve that exact plan and the unequal-length singleton intruders.
  expect(equalPressureLongFirst.state.unroutedRoutes).toEqual([2, 0, 3, 1, 5, 4])
  expect(equalPressureStats.initialRouteOrderingMaxPriority).toBe(1)
  expect(equalPressureStats.initialRouteOrderingChangedPositionCount).toBe(0)

  for (const port of graph.ports) {
    if (port.portId.includes("-intruder-")) port.d.z = 1
  }
  const disjointPrepass = new DuplicateCongestedPortSolverWithIndependentRoutes(graph)
  disjointPrepass.solve()
  expect(disjointPrepass.failed).toBeFalse()
  const disjointLayers = createTinyHypergraphCongestionSolver(graph)
  const disjointStats = initializeTinyHypergraphRouteOrder(disjointLayers, disjointPrepass.independentRouteSegments)
  expect(disjointLayers.state.unroutedRoutes).toEqual([0, 1, 2, 3, 4, 5])
  expect(disjointStats.initialRouteOrderingMaxConflictDegree).toBe(1)
  expect(disjointStats.initialRouteOrderingMaxPriority).toBe(0.5)
})
