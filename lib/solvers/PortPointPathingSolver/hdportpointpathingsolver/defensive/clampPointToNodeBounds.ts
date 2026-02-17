import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

/** Clamps a point to the nearest location inside a node rectangle, including edges. */
export function clampPointToNodeBounds({
  point,
  node,
}: {
  point: { x: number; y: number }
  node: InputNodeWithPortPoints
}): { x: number; y: number } {
  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2

  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY),
  }
}
