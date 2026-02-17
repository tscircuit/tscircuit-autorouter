import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { isPointInRect } from "lib/utils/isPointInRect"

/** Checks whether a point lies inside a node rectangle or exactly on its boundary. */
export function isPointInsideOrOnNodeBounds({
  point,
  node,
}: {
  point: { x: number; y: number }
  node: InputNodeWithPortPoints
}): boolean {
  return isPointInRect(point, node)
}
