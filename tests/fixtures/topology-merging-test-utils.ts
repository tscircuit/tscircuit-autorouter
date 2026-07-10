import type { Bounds } from "@tscircuit/math-utils"
import {
  TopologyMergingSolver,
  type TopologyMergingNodeGroup,
} from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode } from "lib/types"

export function createTopologyMergingTestNode({
  id,
  bounds,
  availableZ,
}: {
  id: string
  bounds: Bounds
  availableZ: number[]
}): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    layer: `z${availableZ.join(",")}`,
    availableZ,
  }
}

export function solveTopologyMergingTestGroups(
  groups: Array<{
    groupId: string
    nodes: CapacityMeshNode[]
    isComponent?: boolean
  }>,
): CapacityMeshNode[] {
  const nodeGroups: TopologyMergingNodeGroup[] = groups.map((group) => ({
    groupId: group.groupId,
    nodes: group.nodes,
    isComponent: group.isComponent ?? true,
  }))
  const solver = new TopologyMergingSolver({ layerCount: 4, nodeGroups })
  solver.solve()
  return solver.getOutput()
}

export function getAvailableZAtPoint(
  nodes: CapacityMeshNode[],
  point: { x: number; y: number },
): number[][] {
  return nodes
    .filter(
      (node) =>
        point.x > node.center.x - node.width / 2 &&
        point.x < node.center.x + node.width / 2 &&
        point.y > node.center.y - node.height / 2 &&
        point.y < node.center.y + node.height / 2,
    )
    .map((node) => node.availableZ)
    .sort((a, b) => a[0]! - b[0]!)
}
