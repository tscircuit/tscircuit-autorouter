import { CapacityMeshNode } from "lib/types"

// Helper interfaces
interface Point {
  x: number
  y: number
}
interface Rect {
  center: Point
  width: number
  height: number
}

/**
 * Calculates the intersection point of a ray starting from startPoint towards endPoint
 * with the boundary of an axis-aligned rectangle.
 * Returns the intersection point closest to startPoint along the ray.
 */
function getEdgeIntersectionPoint(
  startPoint: Point,
  endPoint: Point,
  rect: Rect,
): Point {
  const dx = endPoint.x - startPoint.x
  const dy = endPoint.y - startPoint.y

  // Handle cases where start and end points are the same or very close
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return startPoint

  const halfWidth = rect.width / 2
  const halfHeight = rect.height / 2
  const minX = rect.center.x - halfWidth
  const maxX = rect.center.x + halfWidth
  const minY = rect.center.y - halfHeight
  const maxY = rect.center.y + halfHeight

  let tmin = 0 // Start checking from the origin of the ray
  let tmax = Infinity // Assume ray extends infinitely

  // Check intersection with vertical slab
  if (Math.abs(dx) > 1e-9) {
    const tx1 = (minX - startPoint.x) / dx
    const tx2 = (maxX - startPoint.x) / dx
    tmin = Math.max(tmin, Math.min(tx1, tx2))
    tmax = Math.min(tmax, Math.max(tx1, tx2))
  } else if (startPoint.x < minX || startPoint.x > maxX) {
    // Ray is parallel to Y-axis and outside the vertical slab
    return startPoint // Or handle as no intersection
  }

  // Check intersection with horizontal slab
  if (Math.abs(dy) > 1e-9) {
    const ty1 = (minY - startPoint.y) / dy
    const ty2 = (maxY - startPoint.y) / dy
    tmin = Math.max(tmin, Math.min(ty1, ty2))
    tmax = Math.min(tmax, Math.max(ty1, ty2))
  } else if (startPoint.y < minY || startPoint.y > maxY) {
    // Ray is parallel to X-axis and outside the horizontal slab
    return startPoint // Or handle as no intersection
  }

  // Check if the intersection interval is valid
  if (
    tmax < tmin ||
    tmin === Infinity ||
    tmin < -1e9 /* allow slight numerical errors */
  ) {
    // Fallback: If the start point is inside, the first intersection (tmin) should be valid.
    // If calculation fails unexpectedly, return startPoint as a safe fallback.
    return startPoint
  }

  // Calculate the intersection point using tmin (the first intersection along the ray)
  const intersectX = startPoint.x + dx * tmin
  const intersectY = startPoint.y + dy * tmin

  return { x: intersectX, y: intersectY }
}

/**
 * Calculates the start and end points for drawing a line representing an edge
 * between two CapacityMeshNodes, inset slightly from the node boundaries.
 *
 * @param nodeA The first node.
 * @param nodeB The second node.
 * @returns An object containing the start and end points { lineStart: Point, lineEnd: Point }.
 */
export function getLinesBetweenNodes(
  nodeA: CapacityMeshNode,
  nodeB: CapacityMeshNode,
): { lineStart: Point; lineEnd: Point } {
  const centerA = nodeA.center
  const centerB = nodeB.center

  // Calculate intersection points with outer boundaries
  const intersectA = getEdgeIntersectionPoint(centerA, centerB, nodeA)
  const intersectB = getEdgeIntersectionPoint(centerB, centerA, nodeB)

  // Calculate vector from A to B
  const vec = { dx: centerB.x - centerA.x, dy: centerB.y - centerA.y }
  const len = Math.sqrt(vec.dx * vec.dx + vec.dy * vec.dy)

  let lineStart = intersectA
  let lineEnd = intersectB

  if (len > 1e-9) {
    // Avoid division by zero if centers are coincident
    const unitVec = { x: vec.dx / len, y: vec.dy / len }

    // Calculate margins (e.g., 30% of the node's width)
    const marginA = 0.3 * nodeA.width
    const marginB = 0.3 * nodeB.width

    // Calculate the distance between the intersection points
    const distIntersectAIntersectB = Math.sqrt(
      (intersectB.x - intersectA.x) ** 2 + (intersectB.y - intersectA.y) ** 2,
    )

    // Only apply margin if it doesn't exceed the distance between intersection points
    if (marginA + marginB < distIntersectAIntersectB) {
      lineStart = {
        x: intersectA.x + unitVec.x * marginA,
        y: intersectA.y + unitVec.y * marginA,
      }
      lineEnd = {
        x: intersectB.x - unitVec.x * marginB,
        y: intersectB.y - unitVec.y * marginB,
      }
    } else {
      // If margins overlap, just use the intersection points.
      lineStart = intersectA
      lineEnd = intersectB
    }
  }

  return { lineStart, lineEnd }
}
