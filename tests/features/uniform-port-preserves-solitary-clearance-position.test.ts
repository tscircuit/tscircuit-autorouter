import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("a solitary physical port is not moved even when its edge is unobstructed", (): void => {
  const nodes: NodeWithPortPoints[] = [-1, 1].map((x) => ({
    capacityMeshNodeId: x < 0 ? "left" : "right",
    center: { x, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { portPointId: "p", connectionName: "signal", x: 0, y: 0.7, z: 0 },
    ],
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0],
    portPoints: node.portPoints.map((point) => ({
      ...point,
      portPointId: "p",
      connectionNodeIds: ["left", "right"],
      distToCentermostPortOnZ: 0,
    })),
  }))
  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    obstacles: [],
    preservePhysicalPortPositions: true,
    useLayerAwareGeometry: true,
  })
  solver.solve()
  expect(solver.getOutput().map((node) => node.portPoints[0]!.y)).toEqual([
    0.7, 0.7,
  ])
})
