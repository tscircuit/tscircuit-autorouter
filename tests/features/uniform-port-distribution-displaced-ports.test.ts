import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("displaced ports do not hide the physical shared edge during redistribution", (): void => {
  const ports = [
    { portPointId: "left", connectionName: "a", x: 0.9, y: 0.02, z: 0 },
    { portPointId: "right", connectionName: "b", x: 1.1, y: 0.03, z: 0 },
  ]
  const nodes: NodeWithPortPoints[] = [-1, 1].map((y, i) => ({
    capacityMeshNodeId: i === 0 ? "lower" : "upper",
    center: { x: 1, y },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: ports.map((port) => ({ ...port })),
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0],
    portPoints: ports.map((port) => ({
      ...port,
      connectionNodeIds: ["lower", "upper"],
      distToCentermostPortOnZ: 0,
    })),
  }))
  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    obstacles: [],
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  for (const node of solver.getOutput()) {
    expect(node.portPoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0.5, y: 0 },
      { x: 1.5, y: 0 },
    ])
  }
  expect(nodes[0]!.portPoints[0]!.y).toBe(0.02)
})
