import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { CapacityMeshNode } from "lib/types"
import { limitPortsToRoutingCapacity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitPortsToRoutingCapacity"

test("net-reserved pad regions retain their copper escape ports", () => {
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "pad",
      center: { x: -0.5, y: 0 },
      width: 1,
      height: 1,
      layer: "top",
      availableZ: [0],
      _containsObstacle: true,
    },
    {
      capacityMeshNodeId: "outside",
      center: { x: 0.5, y: 0 },
      width: 1,
      height: 1,
      layer: "top",
      availableZ: [0],
    },
  ]
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "pad", pointIds: ["escape"], d: { netId: 0 } },
      { regionId: "outside", pointIds: ["escape"], d: {} },
    ],
    ports: [
      {
        portId: "escape",
        region1Id: "pad",
        region2Id: "outside",
        d: { x: 0, y: 0, z: 0 },
      },
    ],
  }
  const routingGeometry = {
    layerCount: 2,
    traceWidth: 0.1,
    traceClearance: 0.15,
    obstacles: [
      {
        type: "rect" as const,
        center: { x: -0.5, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pad-net"],
      },
    ],
  }
  const reserved = limitPortsToRoutingCapacity({
    graph,
    nodes,
    routingGeometry,
  })
  expect(reserved.ports).toEqual(graph.ports)
  expect(reserved.regions).toEqual(graph.regions)
  const unreserved = structuredClone(graph)
  unreserved.regions[0]!.d = {}
  const blocked = limitPortsToRoutingCapacity({
    graph: unreserved,
    nodes,
    routingGeometry,
  })
  expect(blocked.ports).toHaveLength(0)
  expect(blocked.regions.every((region) => region.pointIds.length === 0)).toBe(
    true,
  )
})
