import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

const CENTER_EPSILON = 1e-6

export function isAtNodeCenter({
  point,
  node,
}: {
  point: { x: number; y: number }
  node: InputNodeWithPortPoints
}): boolean {
  return (
    Math.abs(point.x - node.center.x) <= CENTER_EPSILON &&
    Math.abs(point.y - node.center.y) <= CENTER_EPSILON
  )
}
