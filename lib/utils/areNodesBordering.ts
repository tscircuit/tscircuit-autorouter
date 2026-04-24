import { CapacityMeshNode } from "../types"
import { getSharedNodeBoundarySegment } from "./capacityMeshNodeGeometry"

export function areNodesBordering(
  node1: CapacityMeshNode,
  node2: CapacityMeshNode,
): boolean {
  if (node1.capacityMeshNodeId === node2.capacityMeshNodeId) {
    return false
  }

  if (node1.polygon || node2.polygon || node1.bounds || node2.bounds) {
    return Boolean(getSharedNodeBoundarySegment(node1, node2))
  }

  const n1Left = node1.center.x - node1.width / 2
  const n1Right = node1.center.x + node1.width / 2
  const n1Top = node1.center.y - node1.height / 2
  const n1Bottom = node1.center.y + node1.height / 2

  const n2Left = node2.center.x - node2.width / 2
  const n2Right = node2.center.x + node2.width / 2
  const n2Top = node2.center.y - node2.height / 2
  const n2Bottom = node2.center.y + node2.height / 2

  const epsilon = 0.001

  const shareVerticalBorder =
    (Math.abs(n1Right - n2Left) < epsilon ||
      Math.abs(n1Left - n2Right) < epsilon) &&
    Math.min(n1Bottom, n2Bottom) - Math.max(n1Top, n2Top) >= epsilon

  const shareHorizontalBorder =
    (Math.abs(n1Bottom - n2Top) < epsilon ||
      Math.abs(n1Top - n2Bottom) < epsilon) &&
    Math.min(n1Right, n2Right) - Math.max(n1Left, n2Left) >= epsilon

  return shareVerticalBorder || shareHorizontalBorder
}
