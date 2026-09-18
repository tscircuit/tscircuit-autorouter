import type { SimpleRouteJson } from "lib/types"

export function assertConnectionPointsWithinBounds(
  srj: SimpleRouteJson,
): void {
  const { minX, maxX, minY, maxY } = srj.bounds
  for (const connection of srj.connections) {
    if (connection.isOffBoard) continue
    for (const [pointIndex, point] of connection.pointsToConnect.entries()) {
      if (
        point.x >= minX &&
        point.x <= maxX &&
        point.y >= minY &&
        point.y <= maxY
      ) {
        continue
      }
      throw new Error(
        `Connection "${connection.name}" point "${point.pointId ?? pointIndex}" at (${point.x}, ${point.y}) is outside routing bounds: x [${minX}, ${maxX}], y [${minY}, ${maxY}]`,
      )
    }
  }
}
