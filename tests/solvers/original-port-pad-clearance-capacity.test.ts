import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { limitPortsToRoutingCapacity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitPortsToRoutingCapacity"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

test("original boundary ports cannot exceed foreign-pad clearance capacity", () => {
  // Sample014's narrow strip has 0.1623 mm between its edge and a pad.
  // A 0.1 mm trace with 0.15 mm clearance needs 0.2 mm center clearance.
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "below",
      center: { x: 0, y: -0.5 },
      width: 0.8,
      height: 1,
      layer: "z0,1",
      availableZ: [0, 1],
    },
    {
      capacityMeshNodeId: "above",
      center: { x: 0, y: 0.08115 },
      width: 0.8,
      height: 0.1623,
      layer: "z0,1",
      availableZ: [0, 1],
    },
  ]
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: -0.495, y: 0.7623 },
    width: 1.4,
    height: 1.2,
    layers: ["top"],
    connectedTo: ["foreign_pad"],
  }
  const ports: SerializedHyperGraph["ports"] = [0, 1].flatMap((z) =>
    [-0.21, 0.21].map((x, index) => ({
      portId: `original_${z}_${index}`,
      region1Id: "below",
      region2Id: "above",
      d: { x, y: 0, z },
    })),
  )
  const graph: SerializedHyperGraph = {
    ports,
    regions: nodes.map((node) => ({
      regionId: node.capacityMeshNodeId,
      d: {},
      pointIds: ports.map((port) => port.portId),
    })),
  }
  const routingGeometry = {
    obstacles: [obstacle],
    layerCount: 2,
    traceWidth: 0.1,
    traceClearance: 0.15,
  }
  const output = limitPortsToRoutingCapacity({ graph, nodes, routingGeometry })
  expect(output.ports.filter((port) => port.d?.z === 0)).toHaveLength(1)
  expect(output.ports.filter((port) => port.d?.z === 1)).toHaveLength(2)
  expect(output.regions.every((region) => region.pointIds.length === 3)).toBe(
    true,
  )
  expect(graph.ports).toHaveLength(4)
  const top = output.ports.find((port) => port.d?.z === 0)!
  const x = top.d?.x
  const y = top.d?.y
  if (typeof x !== "number" || typeof y !== "number")
    throw new Error("Missing boundary coordinates")
  expect(pointToBoxDistance({ x, y }, obstacle)).toBeGreaterThanOrEqual(
    0.2 - 1e-9,
  )
  expect(top.d?.boundaryTraceSpacing).toBe(0.25)
  const port = { portPointId: top.portId, x, y, z: 0, connectionName: "signal" }
  const distribution = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes.map((node) => ({ ...node, portPoints: [port] })),
    inputNodesWithPortPoints: nodes.map((node) => ({
      ...node,
      portPoints: [
        {
          ...port,
          boundaryTraceSpacing: 0.25,
          connectionNodeIds: ["below", "above"],
          distToCentermostPortOnZ: 0,
        },
      ],
    })),
    obstacles: [obstacle],
    routingGeometry: { ...routingGeometry, capacityNodes: nodes },
  })
  distribution.solve()
  expect(distribution.solved).toBe(true)
  for (const node of distribution.getOutput()) {
    expect(
      pointToBoxDistance(node.portPoints[0]!, obstacle),
    ).toBeGreaterThanOrEqual(0.2 - 1e-9)
  }
})
