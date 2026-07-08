import type { CapacityMeshNode } from "lib/types"

export type TargetEscapeSegment = {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export function findTargetEscapeSegment(
  node: CapacityMeshNode,
  adjNode: CapacityMeshNode,
): TargetEscapeSegment {
  const nodeLeft = node.center.x - node.width / 2
  const nodeRight = node.center.x + node.width / 2
  const nodeTop = node.center.y - node.height / 2
  const nodeBottom = node.center.y + node.height / 2
  const adjLeft = adjNode.center.x - adjNode.width / 2
  const adjRight = adjNode.center.x + adjNode.width / 2
  const adjTop = adjNode.center.y - adjNode.height / 2
  const adjBottom = adjNode.center.y + adjNode.height / 2
  const nodeClosestPoint = {
    x: Math.max(nodeLeft, Math.min(adjNode.center.x, nodeRight)),
    y: Math.max(nodeTop, Math.min(adjNode.center.y, nodeBottom)),
  }
  const adjClosestPoint = {
    x: Math.max(adjLeft, Math.min(node.center.x, adjRight)),
    y: Math.max(adjTop, Math.min(node.center.y, adjBottom)),
  }
  const midpoint = {
    x: (nodeClosestPoint.x + adjClosestPoint.x) / 2,
    y: (nodeClosestPoint.y + adjClosestPoint.y) / 2,
  }

  return { start: midpoint, end: midpoint }
}
