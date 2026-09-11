import { expect, test } from "bun:test"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("uniform distribution keeps a shared mesh boundary when crossing points are offset", (): void => {
  const portPoints = [
    { portPointId: "crossing-a", connectionName: "a", x: 0, y: 0, z: 0 },
    { portPointId: "crossing-b", connectionName: "b", x: -0.02, y: 0.01, z: 0 },
    { portPointId: "crossing-c", connectionName: "c", x: -0.04, y: 0.02, z: 0 },
  ]
  const nodes: NodeWithPortPoints[] = [
    {
      capacityMeshNodeId: "left",
      center: { x: -1, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      portPoints,
    },
    {
      capacityMeshNodeId: "right",
      center: { x: 1, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      portPoints,
    },
  ]
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0],
    portPoints: portPoints.map((point) => ({
      ...point,
      connectionNodeIds: ["left", "right"],
      distToCentermostPortOnZ: Math.abs(point.y),
    })),
  }))
  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    obstacles: [],
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const [left, right] = solver.getOutput()
  expect(left!.portPoints).toEqual(right!.portPoints)
  for (const point of left!.portPoints) expect(point.x).toBe(0)
  expect(left!.portPoints[0]!.y).toBeCloseTo(-2 / 3, 12)
  expect(left!.portPoints[1]!.y).toBe(0)
  expect(left!.portPoints[2]!.y).toBeCloseTo(2 / 3, 12)
  expect(nodes[0]!.portPoints[1]!.x).toBe(-0.02)
})
