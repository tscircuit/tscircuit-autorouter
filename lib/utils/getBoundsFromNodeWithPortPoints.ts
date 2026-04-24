import { NodeWithPortPoints } from "lib/types/high-density-types"
import { getNodeBounds } from "./capacityMeshNodeGeometry"

export function getBoundsFromNodeWithPortPoints(
  nodeWithPortPoints: NodeWithPortPoints,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const bounds = { ...getNodeBounds(nodeWithPortPoints as any) }

  // Sometimes port points may be outside the node- this happens when there's
  // a "leap" to the final target or at the end or beginning of a trace when
  // we're wrapping up
  for (const pt of nodeWithPortPoints.portPoints) {
    if (pt.x < bounds.minX) {
      bounds.minX = pt.x
    }
    if (pt.x > bounds.maxX) {
      bounds.maxX = pt.x
    }
    if (pt.y < bounds.minY) {
      bounds.minY = pt.y
    }
    if (pt.y > bounds.maxY) {
      bounds.maxY = pt.y
    }
  }

  return bounds
}
