import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("uniform distribution preserves every globally validated physical port", (): void => {
  const nodes: NodeWithPortPoints[] = [-1, 1].map((x) => ({
    capacityMeshNodeId: x < 0 ? "left" : "right",
    center: { x, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [-0.7, 0.4].map((y, i) => ({
      portPointId: `p${i}`,
      connectionName: `signal${i}`,
      x: 0,
      y,
      z: 0,
    })),
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0],
    portPoints: node.portPoints.map((point) => ({
      ...point,
      portPointId: point.portPointId!,
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
  expect(solver.getOutput()).toEqual(nodes)
})
