import { expect, test } from "bun:test"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("off-boundary duplicates retain their physical shared edge and are redistributed consistently on both owners", () => {
  const ports: PortPoint[] = [
    { portPointId: "original", connectionName: "net_a", x: 0.5, y: 0, z: 0 },
    {
      portPointId: "duplicate",
      connectionName: "net_b",
      x: 0.52,
      y: 0.02,
      z: 0,
    },
  ]
  const nodes: NodeWithPortPoints[] = [0, 1].map((x) => ({
    capacityMeshNodeId: `node_${x}`,
    center: { x, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0],
    portPoints: ports.map((port) => ({ ...port })),
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    layer: "top",
    availableZ: [0],
    portPoints: ports.map((port) => ({
      portPointId: port.portPointId!,
      x: port.x,
      y: port.y,
      z: port.z,
      connectionNodeIds: ["node_0", "node_1"],
      distToCentermostPortOnZ: 0,
    })),
  }))
  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    routingGeometry: {
      capacityNodes: inputNodes,
      layerCount: 2,
      minTraceCenterSpacing: 0.2,
    },
    obstacles: [],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.mapOfOwnerPairToSharedEdge.get("node_0|node_1")?.length).toBe(1)
  for (const node of solver.getOutput()) {
    expect(node.portPoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0.5, y: -0.25 },
      { x: 0.5, y: 0.25 },
    ])
  }
  expect(nodes[0]!.portPoints).toEqual(ports)
})
