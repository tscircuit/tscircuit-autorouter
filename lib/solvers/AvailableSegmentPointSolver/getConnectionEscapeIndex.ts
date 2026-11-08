import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import type { SegmentPortPoint } from "./AvailableSegmentPointSolver"

export type ConnectionEscapeIndex = {
  layerCount: number
  nodeTree: CapacityNodeTree
  freeSpaceComponentIds: Map<CapacityMeshNodeId, CapacityMeshNodeId>
}

/** Index ordinary free-space paths once for all terminal checks. */
export function getConnectionEscapeIndex({
  nodes,
  nodeMap,
  portsByNodeId,
}: {
  nodes: CapacityMeshNode[]
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  portsByNodeId: Map<CapacityMeshNodeId, SegmentPortPoint[]>
}): ConnectionEscapeIndex {
  const freeSpaceComponentIds = new Map<
    CapacityMeshNodeId,
    CapacityMeshNodeId
  >()
  for (const node of nodes) {
    const componentId = node.capacityMeshNodeId
    if (node._containsObstacle || freeSpaceComponentIds.has(componentId)) {
      continue
    }
    const queue = [componentId]
    freeSpaceComponentIds.set(componentId, componentId)
    for (let index = 0; index < queue.length; index++) {
      for (const port of portsByNodeId.get(queue[index]!) ?? []) {
        if (port.cramped) continue
        for (const neighborId of port.nodeIds) {
          if (
            nodeMap.get(neighborId)!._containsObstacle ||
            freeSpaceComponentIds.has(neighborId)
          ) {
            continue
          }
          freeSpaceComponentIds.set(neighborId, componentId)
          queue.push(neighborId)
        }
      }
    }
  }
  return {
    layerCount: nodes.reduce(
      (count, node) => Math.max(count, ...node.availableZ.map((z) => z + 1)),
      1,
    ),
    nodeTree: new CapacityNodeTree(nodes),
    freeSpaceComponentIds,
  }
}
