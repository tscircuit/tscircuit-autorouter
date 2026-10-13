type Point = { x: number; y: number; z: number }

/** Preserve the ordered weighted scan while avoiding redundant square roots. */
export function findClosestFuturePointIndex(
  points: readonly Point[],
  query: Point,
  viaPenaltyDistance: number,
): number {
  let closestIndex = -1
  let minimumDistance = Infinity
  let minimumSameLayerSquared = Infinity
  let minimumOtherLayerSquared = Infinity
  let index = 0
  for (const point of points) {
    const pointIndex = index++
    const dx = query.x - point.x
    const dy = query.y - point.y
    const squaredDistance = dx * dx + dy * dy
    const changesLayer = query.z !== point.z
    const minimumSquared = changesLayer
      ? minimumOtherLayerSquared
      : minimumSameLayerSquared
    // Each group has a constant penalty. Square root and addition are monotone,
    // so a non-improving squared distance cannot improve its already seen score.
    // Keep the original sqrt/addition and strict comparison for every new low;
    // rounded distance ties still retain the first point in original order.
    if (squaredDistance >= minimumSquared) continue
    if (squaredDistance < minimumSquared) {
      if (changesLayer) minimumOtherLayerSquared = squaredDistance
      else minimumSameLayerSquared = squaredDistance
    }
    const candidateDistance =
      Math.sqrt(squaredDistance) + (changesLayer ? viaPenaltyDistance : 0)
    if (candidateDistance < minimumDistance) {
      minimumDistance = candidateDistance
      closestIndex = pointIndex
    }
  }
  return closestIndex
}
