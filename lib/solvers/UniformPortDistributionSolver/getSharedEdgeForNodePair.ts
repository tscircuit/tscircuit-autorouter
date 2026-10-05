import { Bounds, SharedEdge } from "./types"
import { getOwnerPairKey, normalizeOwnerPair } from "./getOwnerPairKey"

const EPSILON = 1e-6

/**
 * Provides tolerant numeric equality checks for boundary-touch detection in
 * shared-edge geometry calculations.
 */
const almostEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) <= EPSILON

/**
 * Finds the single geometric boundary segment shared by two rectangular
 * capacity nodes and annotates orientation, center, and side ownership.
 */
export const getSharedEdgeForNodePair = ({
  nodeAId,
  nodeBId,
  nodeBounds,
}: {
  nodeAId: string
  nodeBId: string
  nodeBounds: Map<string, Bounds>
}): SharedEdge | null => {
  if (nodeAId === nodeBId) return null

  const boundsA = nodeBounds.get(nodeAId)
  const boundsB = nodeBounds.get(nodeBId)
  if (!boundsA || !boundsB) return null

  const ownerNodeIds = normalizeOwnerPair(nodeAId, nodeBId)
  const ownerPairKey = getOwnerPairKey(ownerNodeIds)

  const verticalTouch =
    almostEqual(boundsA.maxX, boundsB.minX) ||
    almostEqual(boundsB.maxX, boundsA.minX)

  if (verticalTouch) {
    const y1 = Math.max(boundsA.minY, boundsB.minY)
    const y2 = Math.min(boundsA.maxY, boundsB.maxY)
    const length = y2 - y1
    if (length > EPSILON) {
      const x = almostEqual(boundsA.maxX, boundsB.minX)
        ? boundsA.maxX
        : boundsA.minX
      const nodeSideByOwnerId: Record<string, "left" | "right"> = almostEqual(
        boundsA.maxX,
        boundsB.minX,
      )
        ? { [nodeAId]: "right", [nodeBId]: "left" }
        : { [nodeAId]: "left", [nodeBId]: "right" }
      return {
        ownerNodeIds,
        ownerPairKey,
        orientation: "vertical",
        x1: x,
        y1,
        x2: x,
        y2,
        center: { x, y: (y1 + y2) / 2 },
        length,
        nodeSideByOwnerId,
      }
    }
  }

  const horizontalTouch =
    almostEqual(boundsA.maxY, boundsB.minY) ||
    almostEqual(boundsB.maxY, boundsA.minY)

  if (horizontalTouch) {
    const x1 = Math.max(boundsA.minX, boundsB.minX)
    const x2 = Math.min(boundsA.maxX, boundsB.maxX)
    const length = x2 - x1
    if (length > EPSILON) {
      const y = almostEqual(boundsA.maxY, boundsB.minY)
        ? boundsA.maxY
        : boundsA.minY
      const nodeSideByOwnerId: Record<string, "top" | "bottom"> = almostEqual(
        boundsA.maxY,
        boundsB.minY,
      )
        ? { [nodeAId]: "top", [nodeBId]: "bottom" }
        : { [nodeAId]: "bottom", [nodeBId]: "top" }
      return {
        ownerNodeIds,
        ownerPairKey,
        orientation: "horizontal",
        x1,
        y1: y,
        x2,
        y2: y,
        center: { x: (x1 + x2) / 2, y },
        length,
        nodeSideByOwnerId,
      }
    }
  }

  return null
}
