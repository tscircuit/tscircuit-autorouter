import { expect, test } from "bun:test"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

test("buildHyperGraph prefers connected exact-match regions over isolated leaf regions", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "isolated-leaf",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "connected-parent",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "neighbor",
      center: { x: 3, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    },
  ]

  const segmentPortPoints: SegmentPortPoint[] = [
    {
      segmentPortPointId: "p0",
      x: 2,
      y: 0,
      availableZ: [0],
      nodeIds: ["connected-parent", "neighbor"],
      edgeId: "e0",
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: false,
    },
  ]

  const simpleRouteJsonConnections: SimpleRouteConnection[] = [
    {
      name: "route0",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 3, y: 0, layer: "top" },
      ],
    },
  ]

  const { connections } = buildHyperGraph({
    capacityMeshNodes,
    layerCount: 2,
    segmentPortPoints,
    simpleRouteJsonConnections,
  })

  expect(connections).toHaveLength(1)
  expect(connections[0]?.startRegion.regionId).toBe("connected-parent")
  expect(connections[0]?.endRegion.regionId).toBe("neighbor")
})

test("buildHyperGraph falls back from a dead-end exact region to a nearby obstacle region", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "dead-end-exact",
      center: { x: 0, y: 0 },
      width: 0.2,
      height: 0.2,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "nearby-obstacle-region",
      center: { x: 0.35, y: 0 },
      width: 0.3,
      height: 0.3,
      layer: "top",
      availableZ: [0],
      _containsObstacle: true,
      _completelyInsideObstacle: false,
    },
    {
      capacityMeshNodeId: "neighbor",
      center: { x: 0.7, y: 0 },
      width: 0.3,
      height: 0.3,
      layer: "top",
      availableZ: [0],
    },
  ]

  const segmentPortPoints: SegmentPortPoint[] = [
    {
      segmentPortPointId: "p0",
      x: 0.52,
      y: 0,
      availableZ: [0],
      nodeIds: ["nearby-obstacle-region", "neighbor"],
      edgeId: "e0",
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: false,
    },
  ]

  const simpleRouteJsonConnections: SimpleRouteConnection[] = [
    {
      name: "route0",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 0.7, y: 0, layer: "top" },
      ],
    },
  ]

  const { connections } = buildHyperGraph({
    capacityMeshNodes,
    layerCount: 2,
    segmentPortPoints,
    simpleRouteJsonConnections,
  })

  expect(connections).toHaveLength(1)
  expect(connections[0]?.startRegion.regionId).toBe("nearby-obstacle-region")
  expect(connections[0]?.endRegion.regionId).toBe("neighbor")
})
