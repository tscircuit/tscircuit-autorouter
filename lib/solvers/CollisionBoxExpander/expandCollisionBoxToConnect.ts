import { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import { doRectsOverlap } from "lib/utils/doRectsOverlap"

/**
 * Expands a collision box to encompass as much area of ignorable neighbors as possible
 * Only operates on layer 0 and only expands collision boxes (nodes with _containsObstacle: true)
 * The collision box will expand to include ignorable nodes while avoiding conflicts with valid nodes
 *
 * @param collisionNode - The collision box node to potentially expand
 * @param allNodes - All nodes in the system to check for neighbors and conflicts
 * @returns Expanded node or original node if no expansion needed/restricted
 */
export function expandCollisionBoxToConnect(
  collisionNode: CapacityMeshNode,
  allNodes: CapacityMeshNode[],
): CapacityMeshNode {
  // Only process collision boxes on layer 0
  if (
    !collisionNode._containsObstacle ||
    !collisionNode.availableZ.includes(0)
  ) {
    return collisionNode
  }

  // Find all ignorable nodes that overlap or are adjacent to this collision box
  const ignorableNodes = allNodes.filter(
    (node) =>
      node.capacityMeshNodeId !== collisionNode.capacityMeshNodeId &&
      (node as any)._isIgnorable &&
      node.availableZ.includes(0) &&
      doRectsOverlap(
        {
          center: { x: node.center.x, y: node.center.y },
          width: node.width,
          height: node.height,
        },
        {
          center: { x: collisionNode.center.x, y: collisionNode.center.y },
          width: collisionNode.width,
          height: collisionNode.height,
        },
      ),
  )

  // If no overlapping ignorable nodes, no expansion needed
  if (ignorableNodes.length === 0) {
    return collisionNode
  }

  // Calculate current collision box bounds
  let currentLeft = collisionNode.center.x - collisionNode.width / 2
  let currentRight = collisionNode.center.x + collisionNode.width / 2
  let currentTop = collisionNode.center.y - collisionNode.height / 2
  let currentBottom = collisionNode.center.y + collisionNode.height / 2

  // Calculate the bounds needed to encompass all ignorable nodes
  let targetLeft = currentLeft
  let targetRight = currentRight
  let targetTop = currentTop
  let targetBottom = currentBottom

  for (const ignorableNode of ignorableNodes) {
    const nodeLeft = ignorableNode.center.x - ignorableNode.width / 2
    const nodeRight = ignorableNode.center.x + ignorableNode.width / 2
    const nodeTop = ignorableNode.center.y - ignorableNode.height / 2
    const nodeBottom = ignorableNode.center.y + ignorableNode.height / 2

    targetLeft = Math.min(targetLeft, nodeLeft)
    targetRight = Math.max(targetRight, nodeRight)
    targetTop = Math.min(targetTop, nodeTop)
    targetBottom = Math.max(targetBottom, nodeBottom)
  }

  // Check for conflicts with valid (non-ignorable) nodes
  const validNodes = allNodes.filter(
    (node) =>
      node.capacityMeshNodeId !== collisionNode.capacityMeshNodeId &&
      !(node as any)._isIgnorable &&
      node.availableZ.includes(0),
  )

  // Try to expand as much as possible without conflicting with valid nodes
  let newLeft = currentLeft
  let newRight = currentRight
  let newTop = currentTop
  let newBottom = currentBottom

  // Check each direction and limit expansion to avoid conflicts
  for (const validNode of validNodes) {
    const validLeft = validNode.center.x - validNode.width / 2
    const validRight = validNode.center.x + validNode.width / 2
    const validTop = validNode.center.y - validNode.height / 2
    const validBottom = validNode.center.y + validNode.height / 2

    // Limit left expansion
    if (validRight > targetLeft && validRight < currentLeft) {
      targetLeft = Math.max(targetLeft, validRight + 0.01) // Small margin
    }

    // Limit right expansion
    if (validLeft < targetRight && validLeft > currentRight) {
      targetRight = Math.min(targetRight, validLeft - 0.01) // Small margin
    }

    // Limit top expansion
    if (validBottom > targetTop && validBottom < currentTop) {
      targetTop = Math.max(targetTop, validBottom + 0.01) // Small margin
    }

    // Limit bottom expansion
    if (validTop < targetBottom && validTop > currentBottom) {
      targetBottom = Math.min(targetBottom, validTop - 0.01) // Small margin
    }
  }

  // Apply the limited expansion
  newLeft = targetLeft
  newRight = targetRight
  newTop = targetTop
  newBottom = targetBottom

  // Calculate final dimensions
  const finalWidth = newRight - newLeft
  const finalHeight = newBottom - newTop

  // Return expanded collision box
  return {
    ...collisionNode,
    center: {
      x: (newLeft + newRight) / 2,
      y: (newTop + newBottom) / 2,
    },
    width: finalWidth,
    height: finalHeight,
  }
}
