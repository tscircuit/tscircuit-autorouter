import type { CapacityMeshNode } from "../types"

export const CAPACITY_NODE_BORDERING_EPSILON = 0.001

export function areNodesBordering(
  node1: CapacityMeshNode,
  node2: CapacityMeshNode,
): boolean {
  const n1Left = node1.center.x - node1.width / 2
  const n1Right = node1.center.x + node1.width / 2
  const n1Top = node1.center.y - node1.height / 2
  const n1Bottom = node1.center.y + node1.height / 2

  const n2Left = node2.center.x - node2.width / 2
  const n2Right = node2.center.x + node2.width / 2
  const n2Top = node2.center.y - node2.height / 2
  const n2Bottom = node2.center.y + node2.height / 2

  const shareVerticalBorder =
    (Math.abs(n1Right - n2Left) < CAPACITY_NODE_BORDERING_EPSILON ||
      Math.abs(n1Left - n2Right) < CAPACITY_NODE_BORDERING_EPSILON) &&
    Math.min(n1Bottom, n2Bottom) - Math.max(n1Top, n2Top) >=
      CAPACITY_NODE_BORDERING_EPSILON

  const shareHorizontalBorder =
    (Math.abs(n1Bottom - n2Top) < CAPACITY_NODE_BORDERING_EPSILON ||
      Math.abs(n1Top - n2Bottom) < CAPACITY_NODE_BORDERING_EPSILON) &&
    Math.min(n1Right, n2Right) - Math.max(n1Left, n2Left) >=
      CAPACITY_NODE_BORDERING_EPSILON

  return shareVerticalBorder || shareHorizontalBorder
}
