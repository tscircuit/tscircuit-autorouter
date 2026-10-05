export function snapToNearestBound(
  point: { x: number; y: number },
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
) {
  // Calculate distances to each boundary for X coordinate
  const distToLeft = Math.abs(point.x - bounds.minX)
  const distToRight = Math.abs(point.x - bounds.maxX)

  // Calculate distances to each boundary for Y coordinate
  const distToTop = Math.abs(point.y - bounds.minY)
  const distToBottom = Math.abs(point.y - bounds.maxY)

  // Find the minimum distance for X and snap X coordinate
  let snappedX = point.x
  const minDistX = Math.min(distToLeft, distToRight)
  if (minDistX === distToLeft) {
    snappedX = bounds.minX
  } else if (minDistX === distToRight) {
    snappedX = bounds.maxX
  }

  // Find the minimum distance for Y and snap Y coordinate
  let snappedY = point.y
  const minDistY = Math.min(distToTop, distToBottom)
  if (minDistY === distToTop) {
    snappedY = bounds.minY
  } else if (minDistY === distToBottom) {
    snappedY = bounds.maxY
  }

  // Return a point with both coordinates snapped independently
  return { x: snappedX, y: snappedY }
}
