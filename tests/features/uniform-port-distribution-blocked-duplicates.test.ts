import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("blocked shared edges retain a common position for duplicate ports", (): void => {
  const nodes: NodeWithPortPoints[] = [-1, 1].map((y, i) => ({
    capacityMeshNodeId: i === 0 ? "lower" : "upper",
    center: { x: 1, y },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      {
        portPointId: "shared",
        connectionName: "signal",
        x: i === 0 ? 0.3 : 0.5,
        y: 0,
        z: 0,
      },
    ],
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0, 1],
    portPoints: node.portPoints.map((port) => ({
      ...port,
      portPointId: port.portPointId!,
      connectionNodeIds: ["lower", "upper"],
      distToCentermostPortOnZ: 0,
    })),
  }))
  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    layerCount: 2,
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 1 },
        width: 2,
        height: 2,
        layers: ["top"],
        connectedTo: [],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput().map((node) => node.portPoints[0]!.x)).toEqual([
    0.3, 0.3,
  ])
  expect(nodes[1]!.portPoints[0]!.x).toBe(0.5)
})
