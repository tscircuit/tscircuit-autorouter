import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Bounds, SharedEdge, Side } from "./types"

const epsilon = 1e-6

const getPerimeterPosition = (point: PortPoint, bounds: Bounds) => {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  if (Math.abs(point.y - bounds.minY) < epsilon) {
    return point.x - bounds.minX
  }
  if (Math.abs(point.x - bounds.maxX) < epsilon) {
    return width + point.y - bounds.minY
  }
  if (Math.abs(point.y - bounds.maxY) < epsilon) {
    return width + height + bounds.maxX - point.x
  }
  if (Math.abs(point.x - bounds.minX) < epsilon) {
    return 2 * width + height + bounds.maxY - point.y
  }
  return null
}

const getPositionOnSide = (
  point: { x: number; y: number },
  side: Side,
  bounds: Bounds,
) => {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  switch (side) {
    case "bottom":
      return point.x - bounds.minX
    case "right":
      return width + point.y - bounds.minY
    case "top":
      return width + height + bounds.maxX - point.x
    case "left":
      return 2 * width + height + bounds.maxY - point.y
  }
}

const getPairedEndpoint = (node: NodeWithPortPoints, portPointId: string) => {
  for (const [start, end] of node.portPointsInPairs ?? []) {
    if (start.portPointId === portPointId) return end
    if (end.portPointId === portPointId) return start
  }
  return null
}

/**
 * Scores a shared-edge port by where its paired endpoint appears around each
 * owner node. Sorting tied ports by this score avoids alternating endpoint
 * pairs, which would force a crossing inside a single-layer rectangle.
 */
export const getPlanarPortOrderScore = ({
  portPoint,
  sharedEdge,
  nodeById,
  boundsByNodeId,
}: {
  portPoint: PortPoint
  sharedEdge: SharedEdge
  nodeById: Map<string, NodeWithPortPoints>
  boundsByNodeId: Map<string, Bounds>
}): number | null => {
  if (!portPoint.portPointId) return null

  const scores: number[] = []
  for (const ownerNodeId of sharedEdge.ownerNodeIds) {
    const node = nodeById.get(ownerNodeId)
    const bounds = boundsByNodeId.get(ownerNodeId)
    const side = sharedEdge.nodeSideByOwnerId[ownerNodeId]
    if (!node || !bounds || !side) continue

    const pairedEndpoint = getPairedEndpoint(node, portPoint.portPointId)
    if (!pairedEndpoint) continue
    const pairedPosition = getPerimeterPosition(pairedEndpoint, bounds)
    if (pairedPosition === null) continue

    const perimeter =
      2 * (bounds.maxX - bounds.minX + bounds.maxY - bounds.minY)
    const sharedEdgeEnd = Math.max(
      getPositionOnSide({ x: sharedEdge.x1, y: sharedEdge.y1 }, side, bounds),
      getPositionOnSide({ x: sharedEdge.x2, y: sharedEdge.y2 }, side, bounds),
    )
    const positionAfterSharedEdge =
      (pairedPosition - sharedEdgeEnd + perimeter) % perimeter
    const axisFollowsPerimeter = side === "bottom" || side === "right"

    scores.push(
      (axisFollowsPerimeter
        ? -positionAfterSharedEdge
        : positionAfterSharedEdge) / perimeter,
    )
  }

  if (scores.length === 0) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}
