import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type { CapacityMeshNode } from "lib/types"

test("layer copies share an explicit physical portal group through hypergraph serialization", () => {
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "left",
      center: { x: -0.5, y: 0 },
      width: 1,
      height: 4,
      layer: "z0,1",
      availableZ: [0, 1],
    },
    {
      capacityMeshNodeId: "right",
      center: { x: 0.5, y: 0 },
      width: 1,
      height: 4,
      layer: "z0,1",
      availableZ: [0, 1],
    },
  ]
  const solver = new AvailableSegmentPointSolver({
    nodes,
    edges: [
      {
        capacityMeshEdgeId: "shared-edge",
        nodeIds: ["left", "right"],
      },
    ],
    traceWidth: 0.1,
    shouldReturnCrampedPortPoints: true,
  })

  solver.solve()

  const portPoints = solver.sharedEdgeSegments[0]!.portPoints
  const portPointsByGroup = Map.groupBy(
    portPoints,
    (portPoint) => portPoint.physicalPortGroupId,
  )
  expect(portPointsByGroup.size).toBeGreaterThan(1)
  expect(
    [...portPointsByGroup.values()].every(
      (layerCopies) =>
        layerCopies.length === 2 &&
        layerCopies[0]!.x === layerCopies[1]!.x &&
        layerCopies[0]!.y === layerCopies[1]!.y &&
        layerCopies[0]!.availableZ[0] !== layerCopies[1]!.availableZ[0],
    ),
  ).toBe(true)

  const { graph } = buildHyperGraph({
    capacityMeshNodes: nodes,
    segmentPortPoints: portPoints,
    simpleRouteJsonConnections: [],
    layerCount: 2,
    connectivityMap: new ConnectivityMap({}),
  })
  const serializedPortsByGroup = Map.groupBy(
    graph.ports,
    (port) => port.d.physicalPortGroupId,
  )
  expect(serializedPortsByGroup.size).toBe(portPointsByGroup.size)
  expect(
    [...serializedPortsByGroup.values()].every(
      (layerCopies) => layerCopies.length === 2,
    ),
  ).toBe(true)
})
