import type { Bounds } from "@tscircuit/math-utils"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { getCapacityMeshNodeBounds } from "../TopologyPlanningSolver/capacity-node-geometry"

type BgaFreeSpace = {
  tree: CapacityNodeTree
  bounds: Bounds
  canExitByNodeId: Map<CapacityMeshNodeId, boolean>
}

function touchesBgaBoundary(node: CapacityMeshNode, bounds: Bounds): boolean {
  const nodeBounds = getCapacityMeshNodeBounds(node)
  return (
    nodeBounds.minX <= bounds.minX + 0.001 ||
    nodeBounds.maxX >= bounds.maxX - 0.001 ||
    nodeBounds.minY <= bounds.minY + 0.001 ||
    nodeBounds.maxY >= bounds.maxY - 0.001
  )
}

function getFreeNeighbors(
  node: CapacityMeshNode,
  tree: CapacityNodeTree,
): CapacityMeshNode[] {
  return tree
    .getNodesInArea(
      node.center.x,
      node.center.y,
      node.width * 2,
      node.height * 2,
    )
    .filter(
      (neighbor) =>
        areNodesBordering(node, neighbor) &&
        node.availableZ.some((z) => neighbor.availableZ.includes(z)),
    )
}

function canReachBgaExit(
  node: CapacityMeshNode,
  freeSpace: BgaFreeSpace,
): boolean {
  const knownExit = freeSpace.canExitByNodeId.get(node.capacityMeshNodeId)
  if (knownExit !== undefined) return knownExit
  const pending = [node]
  const visited = new Set<CapacityMeshNodeId>()
  let canExit = false
  while (pending.length > 0) {
    const current = pending.pop()!
    if (visited.has(current.capacityMeshNodeId)) continue
    visited.add(current.capacityMeshNodeId)
    if (
      freeSpace.canExitByNodeId.get(current.capacityMeshNodeId) === true ||
      current.availableZ.length > 1 ||
      touchesBgaBoundary(current, freeSpace.bounds)
    ) {
      canExit = true
      break
    }
    if (freeSpace.canExitByNodeId.get(current.capacityMeshNodeId) === false) {
      continue
    }
    pending.push(...getFreeNeighbors(current, freeSpace.tree))
  }
  for (const nodeId of visited) {
    freeSpace.canExitByNodeId.set(nodeId, canExit)
  }
  return canExit
}

/** Find pads whose existing surface space has no boundary or via exit.
 * Bounds and centers are board-world points in mm, +X right and +Y up. */
export function getBgaTargetsNeedingViaAccess({
  routingRegions,
  bounds,
}: {
  routingRegions: CapacityMeshNode[]
  bounds: Bounds
}): CapacityMeshNode[] {
  const freeRegions = routingRegions.filter(
    (node) => !node._containsObstacle && !node._containsTarget,
  )
  const freeSpace: BgaFreeSpace = {
    tree: new CapacityNodeTree(freeRegions),
    bounds,
    canExitByNodeId: new Map(),
  }
  return routingRegions.filter((target) => {
    if (!target._containsTarget || touchesBgaBoundary(target, bounds)) {
      return false
    }
    return !getFreeNeighbors(target, freeSpace.tree).some(
      (neighbor) => canReachBgaExit(neighbor, freeSpace),
    )
  })
}
