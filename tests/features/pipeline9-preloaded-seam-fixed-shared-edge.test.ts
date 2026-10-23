import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("a real shared edge preserves its immutable layer rather than placing a foreign port on the seam", (): void => {
  const fixed: PortPoint = { connectionName: "fixed-net", portPointId: "fixed", x: 0, y: 0, z: 0 }
  const moving: PortPoint = { connectionName: "foreign-net", portPointId: "moving", x: 0, y: 1, z: 0 }
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id) => ({
    capacityMeshNodeId: id, center: { x: id === "left" ? -1 : 1, y: 0 }, width: 2, height: 4,
    portPoints: [structuredClone(fixed), structuredClone(moving)],
    portPointsInPairs: [[structuredClone(fixed), structuredClone(moving)]],
  }))
  const inputNodes = nodes.map((node) => ({ ...node, portPoints: node.portPoints.map((point) => ({ ...point,
    connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: Math.abs(point.y),
  })) })) as InputNodeWithPortPoints[]
  const unlocked = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes,
    obstacles: [], layerCount: 2, useLayerAwareGeometry: true })
  const locked = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes,
    obstacles: [], layerCount: 2, useLayerAwareGeometry: true, immutablePortIds: new Set(["fixed"]) })
  unlocked.solve()
  locked.solve()
  expect(unlocked.mapOfOwnerPairToSharedEdge.size).toBe(1)
  expect(unlocked.getOutput()).not.toEqual(nodes)
  expect(locked.getOutput()).toEqual(nodes)
  expect(locked.stats.immutableLayerFamiliesPreserved).toBe(1)
  for (const node of locked.getOutput()) {
    expect(node.portPoints.map((point) => point.y)).toEqual([0, 1])
    expect(node.portPointsInPairs![0]!.map((point) => point.y)).toEqual([0, 1])
  }
})
